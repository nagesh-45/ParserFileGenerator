package com.xsdgenerator.service;

import com.xsdgenerator.dto.SchemaField;
import com.xsdgenerator.exception.XmlValidationException;
import org.apache.xerces.impl.xs.XMLSchemaLoader;
import org.apache.xerces.xs.XSAnnotation;
import org.apache.xerces.xs.XSAttributeDeclaration;
import org.apache.xerces.xs.XSAttributeUse;
import org.apache.xerces.xs.XSComplexTypeDefinition;
import org.apache.xerces.xs.XSConstants;
import org.apache.xerces.xs.XSElementDeclaration;
import org.apache.xerces.xs.XSModel;
import org.apache.xerces.xs.XSModelGroup;
import org.apache.xerces.xs.XSNamedMap;
import org.apache.xerces.xs.XSObjectList;
import org.apache.xerces.xs.XSParticle;
import org.apache.xerces.xs.XSSimpleTypeDefinition;
import org.apache.xerces.xs.XSTerm;
import org.apache.xerces.xs.XSTypeDefinition;
import org.apache.xerces.xs.XSWildcard;
import org.apache.xerces.xs.StringList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.ls.LSInput;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Source;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.Reader;
import java.io.StringReader;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.w3c.dom.ls.LSResourceResolver;

/**
 * Parses XSD schemas via Apache Xerces {@link XSModel}, builds formatted XML from form values,
 * and validates generated XML against the same uploaded XSD.
 */
@Service
public class XsdParserService {

    private static final Logger log = LoggerFactory.getLogger(XsdParserService.class);
    private static final String XSD_NS = XMLConstants.W3C_XML_SCHEMA_NS_URI;
    /** Prevents StackOverflow on recursive ISO 20022 types (common in pacs/pain/camt). */
    private static final int MAX_MAPPING_DEPTH = 18;

    private final ConcurrentHashMap<String, StoredSchema> schemaStore = new ConcurrentHashMap<>();
    private final AtomicInteger choiceCounter = new AtomicInteger();

    public ParsedSchema parseAndStoreXsd(byte[] xsdBytes, String fileName) {
        return parseAndStoreUpload(xsdBytes, fileName);
    }

    /**
     * Accepts a single .xsd or a .zip of related XSDs (pacs.008 + imports).
     */
    public ParsedSchema parseAndStoreUpload(byte[] uploadBytes, String fileName) {
        if (uploadBytes == null || uploadBytes.length == 0) {
            throw new IllegalArgumentException("XSD file is empty");
        }
        String safeName = sanitizeFileName(fileName);
        Map<String, byte[]> files = new LinkedHashMap<>();
        String primaryName;
        try {
            if (safeName.toLowerCase(Locale.ROOT).endsWith(".zip") || looksLikeZip(uploadBytes)) {
                files.putAll(extractXsdFilesFromZip(uploadBytes));
                if (files.isEmpty()) {
                    throw new IllegalArgumentException("ZIP did not contain any .xsd files");
                }
                primaryName = choosePrimarySchema(files);
            } else {
                primaryName = safeName.toLowerCase(Locale.ROOT).endsWith(".xsd")
                        || safeName.toLowerCase(Locale.ROOT).endsWith(".xml")
                        ? safeName
                        : safeName + ".xsd";
                files.put(primaryName, uploadBytes.clone());
            }
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalArgumentException("Unable to read uploaded schema: " + ex.getMessage(), ex);
        }

        byte[] primaryBytes = files.get(primaryName);
        List<SchemaField> roots;
        try {
            roots = parseXsd(primaryBytes, primaryName, files);
        } catch (StackOverflowError err) {
            throw new IllegalArgumentException(
                    "Schema is too deeply recursive to expand. Upload a single message XSD "
                            + "(e.g. pacs.008.001.08.xsd) or a ZIP of its related XSDs.");
        } catch (OutOfMemoryError err) {
            throw new IllegalArgumentException(
                    "Schema is too large to expand in memory. Prefer the official single-file pacs.008 XSD.");
        }

        String schemaId = UUID.randomUUID().toString();
        schemaStore.put(schemaId, new StoredSchema(primaryName, primaryBytes.clone(), files, roots));
        log.info("Stored XSD '{}' ({} companion file(s)) under schemaId={}, roots={}",
                primaryName, files.size(), schemaId, roots.size());
        return new ParsedSchema(schemaId, primaryName, roots);
    }

    public List<SchemaField> parseXsd(byte[] xsdBytes, String fileName) {
        return parseXsd(xsdBytes, fileName, Map.of(sanitizeFileName(fileName), xsdBytes));
    }

    public List<SchemaField> parseXsd(byte[] xsdBytes, String fileName, Map<String, byte[]> companions) {
        if (xsdBytes == null || xsdBytes.length == 0) {
            throw new IllegalArgumentException("XSD file is empty");
        }

        XSModel model = loadSchemaModel(xsdBytes, fileName, companions);
        XSNamedMap elements = model.getComponents(XSConstants.ELEMENT_DECLARATION);
        if (elements == null || elements.getLength() == 0) {
            throw new IllegalArgumentException("No global element declarations found in the XSD");
        }

        List<SchemaField> roots = new ArrayList<>();
        for (int i = 0; i < elements.getLength(); i++) {
            XSElementDeclaration element = (XSElementDeclaration) elements.item(i);
            SchemaField field = mapElement(
                    element,
                    "/" + element.getName(),
                    1,
                    1,
                    0,
                    Collections.newSetFromMap(new IdentityHashMap<>()));
            roots.add(field);
        }

        // Prefer ISO 20022 Document root first for pacs/pain/camt schemas
        roots.sort((a, b) -> {
            boolean aDoc = "Document".equals(a.getName());
            boolean bDoc = "Document".equals(b.getName());
            if (aDoc == bDoc) {
                return String.valueOf(a.getName()).compareToIgnoreCase(String.valueOf(b.getName()));
            }
            return aDoc ? -1 : 1;
        });

        log.info("Parsed XSD '{}': {} root element(s)", fileName, roots.size());
        return roots;
    }

    /**
     * Generates XML from form values and validates it against the previously uploaded XSD.
     * Uses the server-stored schema tree (needed for large pacs.008 payloads).
     */
    public String generateAndValidateXml(String schemaId, SchemaField clientSchema, Map<String, Object> values) {
        StoredSchema stored = requireStoredSchema(schemaId);
        SchemaField rootSchema = resolveRootSchema(stored, clientSchema);
        String xml = generateXml(rootSchema, values);
        validateXmlAgainstXsd(xml, stored);
        return xml;
    }

    public String generateAndValidateXml(String schemaId, String rootName, Map<String, Object> values) {
        StoredSchema stored = requireStoredSchema(schemaId);
        SchemaField stub = new SchemaField();
        stub.setName(rootName);
        return generateAndValidateXml(schemaId, stub, values);
    }

    private SchemaField resolveRootSchema(StoredSchema stored, SchemaField clientSchema) {
        String wanted = clientSchema != null ? clientSchema.getName() : null;
        if (wanted == null || wanted.isBlank()) {
            if (stored.roots() != null && !stored.roots().isEmpty()) {
                return stored.roots().get(0);
            }
            throw new IllegalArgumentException("Root element name is missing");
        }
        if (stored.roots() != null) {
            for (SchemaField root : stored.roots()) {
                if (wanted.equals(root.getName())) {
                    return root;
                }
            }
        }
        // Fall back to client schema only if server tree is missing (should not happen)
        if (clientSchema != null && clientSchema.getChildren() != null && !clientSchema.getChildren().isEmpty()) {
            return clientSchema;
        }
        throw new IllegalArgumentException(
                "Root element '" + wanted + "' was not found in the uploaded schema. Please re-upload the XSD.");
    }

    public String generateXml(SchemaField rootSchema, Map<String, Object> values) {
        if (rootSchema == null) {
            throw new IllegalArgumentException("Schema metadata is required");
        }

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            Document document = factory.newDocumentBuilder().newDocument();

            Object rootValue = values != null ? values.get(rootSchema.getName()) : null;
            if (rootValue == null && values != null && !values.containsKey(rootSchema.getName())) {
                rootValue = values;
            }

            Element rootElement = buildElement(document, rootSchema, rootValue);
            // Ensure default xmlns is present for ISO 20022 Document roots
            if (rootSchema.getNamespace() != null && !rootSchema.getNamespace().isBlank()) {
                rootElement.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns", rootSchema.getNamespace());
            }
            document.appendChild(rootElement);
            return formatXml(document);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to generate XML: " + e.getMessage(), e);
        }
    }

    public void validateXmlAgainstXsd(String xml, byte[] xsdBytes, String xsdFileName) {
        Map<String, byte[]> files = new LinkedHashMap<>();
        files.put(sanitizeFileName(xsdFileName), xsdBytes);
        validateXmlAgainstXsd(xml, new StoredSchema(xsdFileName, xsdBytes, files, List.of()));
    }

    private void validateXmlAgainstXsd(String xml, StoredSchema stored) {
        if (xml == null || xml.isBlank()) {
            throw new IllegalArgumentException("Generated XML is empty");
        }
        if (stored == null || stored.bytes() == null || stored.bytes().length == 0) {
            throw new IllegalArgumentException("Uploaded XSD is missing; please re-upload the schema");
        }

        List<String> errors = new ArrayList<>();
        try {
            SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
            // Allow resolving companion schemas from the uploaded ZIP / same package only
            schemaFactory.setResourceResolver(new MapLsResourceResolver(stored.files(), stored.fileName()));

            Source schemaSource = new StreamSource(
                    new ByteArrayInputStream(stored.bytes()), sanitizeFileName(stored.fileName()));
            Schema schema = schemaFactory.newSchema(schemaSource);
            Validator validator = schema.newValidator();
            validator.setErrorHandler(new CollectingErrorHandler(errors));
            validator.validate(new StreamSource(new StringReader(xml)));
        } catch (SAXException ex) {
            if (errors.isEmpty()) {
                errors.add(ex.getMessage() != null ? ex.getMessage() : "XML failed XSD validation");
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to validate XML against XSD: " + ex.getMessage(), ex);
        }

        if (!errors.isEmpty()) {
            throw new XmlValidationException(
                    "Generated XML is not valid against the uploaded XSD (" + errors.size() + " error(s))",
                    errors);
        }
    }

    private StoredSchema requireStoredSchema(String schemaId) {
        if (schemaId == null || schemaId.isBlank()) {
            throw new IllegalArgumentException("schemaId is required. Please upload the XSD again.");
        }
        StoredSchema stored = schemaStore.get(schemaId);
        if (stored == null) {
            throw new IllegalArgumentException(
                    "Uploaded XSD session not found (schemaId=" + schemaId + "). Please re-upload the XSD.");
        }
        return stored;
    }

    private Element buildElement(Document document, SchemaField field, Object value) {
        Element element = createElement(document, field);

        Map<String, Object> valueMap = asMap(value);
        Object textValue = value;
        Map<String, Object> attrs = null;

        if (valueMap != null) {
            attrs = asMap(valueMap.get("_attrs"));
            if (valueMap.containsKey("_text")) {
                textValue = valueMap.get("_text");
            } else if (!field.isComplex()) {
                textValue = null;
            }
        }

        applyAttributes(document, element, field, attrs, valueMap);

        if (field.isComplex()) {
            Map<String, Object> childValues = valueMap;
            Map<String, Integer> chosenBranch = new LinkedHashMap<>();
            for (SchemaField child : field.getChildren()) {
                if (child.getChoiceGroup() == null) {
                    continue;
                }
                Object childValue = childValues != null ? childValues.get(child.getName()) : null;
                if (!shouldOmit(child, childValue) && !chosenBranch.containsKey(child.getChoiceGroup())) {
                    Integer branch = child.getChoiceBranch() != null ? child.getChoiceBranch() : 0;
                    chosenBranch.put(child.getChoiceGroup(), branch);
                }
            }

            for (SchemaField child : field.getChildren()) {
                Object childValue = childValues != null ? childValues.get(child.getName()) : null;
                if (child.getChoiceGroup() != null) {
                    Integer chosen = chosenBranch.get(child.getChoiceGroup());
                    Integer branch = child.getChoiceBranch() != null ? child.getChoiceBranch() : 0;
                    if (chosen != null && !chosen.equals(branch)) {
                        continue;
                    }
                }
                appendChildOccurrences(document, element, child, childValue);
            }
        } else if (textValue != null && !(textValue instanceof Map) && !(textValue instanceof List)) {
            String text = normalizeLexicalValue(field, String.valueOf(textValue).trim());
            if (!text.isEmpty()) {
                element.setTextContent(text);
            }
        }

        return element;
    }

    private void applyAttributes(Document document, Element element, SchemaField field,
                                 Map<String, Object> attrsFromPayload, Map<String, Object> valueMap) {
        if (field.getAttributes() == null || field.getAttributes().isEmpty()) {
            return;
        }
        for (SchemaField attr : field.getAttributes()) {
            Object raw = null;
            if (attrsFromPayload != null && attrsFromPayload.containsKey(attr.getName())) {
                raw = attrsFromPayload.get(attr.getName());
            } else if (valueMap != null && valueMap.containsKey("@" + attr.getName())) {
                raw = valueMap.get("@" + attr.getName());
            }
            if (raw == null || String.valueOf(raw).isBlank()) {
                continue;
            }
            String lexical = normalizeLexicalValue(attr, String.valueOf(raw).trim());
            if (attr.getNamespace() != null && !attr.getNamespace().isBlank()) {
                element.setAttributeNS(attr.getNamespace(), attr.getName(), lexical);
            } else {
                element.setAttribute(attr.getName(), lexical);
            }
        }
    }

    private String normalizeLexicalValue(SchemaField field, String value) {
        if (value == null) {
            return "";
        }
        String type = field.getType() != null ? field.getType() : "";
        if ("dateTime".equals(type) && value.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}")) {
            return value + ":00";
        }
        // Enforce fractionDigits=0 (or integer type) by dropping a fractional part
        if (("integer".equals(type) || (field.getFractionDigits() != null && field.getFractionDigits() == 0))
                && value.matches("-?\\d+\\.\\d+")) {
            return value.substring(0, value.indexOf('.'));
        }
        if (("decimal".equals(type) || value.matches("-?\\d+(\\.\\d+)?"))
                && (field.getFractionDigits() != null || field.getTotalDigits() != null)
                && value.matches("-?\\d+(\\.\\d+)?")) {
            try {
                java.math.BigDecimal bd = new java.math.BigDecimal(value);
                int frac = field.getFractionDigits() != null ? field.getFractionDigits() : Math.max(0, bd.scale());
                if (field.getFractionDigits() != null) {
                    bd = bd.setScale(frac, java.math.RoundingMode.HALF_UP);
                }
                if (field.getTotalDigits() != null) {
                    int total = field.getTotalDigits();
                    int intDigits = Math.max(1, total - Math.max(frac, 0));
                    java.math.BigDecimal max = java.math.BigDecimal.TEN.pow(intDigits)
                            .subtract(java.math.BigDecimal.ONE.movePointLeft(Math.max(frac, 0)));
                    if (bd.abs().compareTo(max) > 0) {
                        bd = max;
                        if (field.getFractionDigits() != null) {
                            bd = bd.setScale(frac, java.math.RoundingMode.HALF_UP);
                        }
                    }
                }
                return bd.stripTrailingZeros().scale() < 0
                        ? bd.setScale(0).toPlainString()
                        : bd.toPlainString();
            } catch (NumberFormatException ignored) {
                return value;
            }
        }
        return value;
    }

    private Element createElement(Document document, SchemaField field) {
        String ns = field.getNamespace();
        if (ns != null && !ns.isBlank()) {
            return document.createElementNS(ns, field.getName());
        }
        return document.createElement(field.getName());
    }

    private void appendChildOccurrences(Document document, Element parent, SchemaField child, Object childValue) {
        if (childValue instanceof List<?> list) {
            for (Object item : list) {
                if (shouldOmit(child, item)) {
                    continue;
                }
                parent.appendChild(buildElement(document, child, item));
            }
            return;
        }

        if (shouldOmit(child, childValue)) {
            return;
        }
        parent.appendChild(buildElement(document, child, childValue));
    }

    private boolean shouldOmit(SchemaField field, Object value) {
        if (value == null) {
            return !field.isRequired();
        }
        if (value instanceof String s) {
            return s.trim().isEmpty() && !field.isRequired();
        }
        if (value instanceof Map<?, ?> map) {
            return map.isEmpty() && !field.isRequired();
        }
        return false;
    }

    private Map<String, Object> asMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() != null) {
                    result.put(String.valueOf(entry.getKey()), entry.getValue());
                }
            }
            return result;
        }
        return null;
    }

    private String formatXml(Document document) throws Exception {
        TransformerFactory transformerFactory = TransformerFactory.newInstance();
        Transformer transformer = transformerFactory.newTransformer();
        transformer.setOutputProperty(OutputKeys.INDENT, "yes");
        transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
        transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no");
        transformer.setOutputProperty("{http://xml.apache.org/xslt}indent-amount", "2");

        StringWriter writer = new StringWriter();
        transformer.transform(new DOMSource(document), new StreamResult(writer));
        return writer.toString();
    }

    private XSModel loadSchemaModel(byte[] xsdBytes, String fileName, Map<String, byte[]> companions) {
        XMLSchemaLoader loader = new XMLSchemaLoader();
        loader.setEntityResolver(new MapXmlEntityResolver(companions != null ? companions : Map.of(), fileName));
        LSInput input = new ByteArrayLSInput(xsdBytes, sanitizeFileName(fileName));
        XSModel model = loader.load(input);
        if (model == null) {
            try {
                java.nio.file.Path tempDir = java.nio.file.Files.createTempDirectory("xsd-upload-");
                try {
                    Map<String, byte[]> all = companions != null ? companions : Map.of(sanitizeFileName(fileName), xsdBytes);
                    for (Map.Entry<String, byte[]> e : all.entrySet()) {
                        java.nio.file.Path out = tempDir.resolve(sanitizeFileName(e.getKey()));
                        java.nio.file.Files.write(out, e.getValue());
                    }
                    java.nio.file.Path primary = tempDir.resolve(sanitizeFileName(fileName));
                    if (!java.nio.file.Files.exists(primary)) {
                        primary = tempDir.resolve(sanitizeFileName(choosePrimarySchema(all)));
                    }
                    model = loader.loadURI(primary.toUri().toString());
                } finally {
                    try (var paths = java.nio.file.Files.walk(tempDir)) {
                        paths.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                            try {
                                java.nio.file.Files.deleteIfExists(p);
                            } catch (Exception ignored) {
                            }
                        });
                    }
                }
            } catch (Exception ex) {
                throw new IllegalArgumentException(
                        "Unable to load XSD schema. For pacs.008 upload the message XSD, "
                                + "or a ZIP containing it plus any imported XSDs. Detail: " + ex.getMessage(),
                        ex);
            }
        }
        if (model == null) {
            throw new IllegalArgumentException(
                    "Unable to load XSD schema. Ensure the file is a valid XML Schema "
                            + "(for pacs.008, use the official single-file XSD or a ZIP of related schemas).");
        }
        return model;
    }

    private boolean looksLikeZip(byte[] bytes) {
        return bytes != null && bytes.length >= 4
                && bytes[0] == 'P' && bytes[1] == 'K';
    }

    private Map<String, byte[]> extractXsdFilesFromZip(byte[] zipBytes) throws Exception {
        Map<String, byte[]> files = new LinkedHashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName().replace('\\', '/');
                int slash = name.lastIndexOf('/');
                String base = slash >= 0 ? name.substring(slash + 1) : name;
                if (!base.toLowerCase(Locale.ROOT).endsWith(".xsd")) {
                    continue;
                }
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                zis.transferTo(bos);
                files.put(sanitizeFileName(base), bos.toByteArray());
            }
        }
        return files;
    }

    private String choosePrimarySchema(Map<String, byte[]> files) {
        List<String> names = new ArrayList<>(files.keySet());
        names.sort((a, b) -> {
            int sa = primaryScore(a);
            int sb = primaryScore(b);
            if (sa != sb) {
                return Integer.compare(sb, sa);
            }
            return Integer.compare(files.get(b).length, files.get(a).length);
        });
        return names.get(0);
    }

    private int primaryScore(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int score = 0;
        if (n.contains("pacs.008")) score += 100;
        if (n.contains("pacs.")) score += 40;
        if (n.contains("pain.")) score += 30;
        if (n.contains("camt.")) score += 20;
        if (n.startsWith("head.")) score -= 50;
        return score;
    }

    private String sanitizeFileName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            return "schema.xsd";
        }
        return fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private SchemaField mapElement(XSElementDeclaration element, String xpath, int minOccurs, int maxOccurs,
                                    int depth, Set<XSTypeDefinition> typeStack) {
        SchemaField field = new SchemaField();
        field.setName(element.getName());
        field.setNamespace(element.getNamespace());
        field.setXpath(xpath);
        field.setMinOccurs(minOccurs);
        field.setMaxOccurs(maxOccurs == Integer.MAX_VALUE ? -1 : maxOccurs);
        field.setRequired(minOccurs >= 1);
        field.setDocumentation(extractDocumentation(element.getAnnotations()));

        XSTypeDefinition typeDef = element.getTypeDefinition();
        if (typeDef == null) {
            field.setType("string");
            field.setComplex(false);
            return field;
        }

        if (typeDef.getTypeCategory() == XSTypeDefinition.COMPLEX_TYPE) {
            XSComplexTypeDefinition complex = (XSComplexTypeDefinition) typeDef;
            field.setTypeName(resolveTypeName(typeDef));
            field.getAttributes().addAll(mapAttributes(complex));

            if (complex.getContentType() == XSComplexTypeDefinition.CONTENTTYPE_SIMPLE) {
                // Element with simple content + optional attributes (e.g. InstdAmt Ccy="EUR")
                XSSimpleTypeDefinition simple = complex.getSimpleType();
                field.setComplex(false);
                applySimpleTypeMetadata(field, simple);
            } else if (complex.getContentType() == XSComplexTypeDefinition.CONTENTTYPE_EMPTY) {
                field.setComplex(true);
                field.setType(resolveTypeName(typeDef));
            } else {
                field.setComplex(true);
                field.setType(resolveTypeName(typeDef));

                // Truncate recursive / extremely deep ISO types (pacs.008 has several)
                if (typeStack.contains(typeDef) || depth >= MAX_MAPPING_DEPTH) {
                    String note = typeStack.contains(typeDef)
                            ? "Recursive type truncated"
                            : "Deep nesting truncated at depth " + depth;
                    field.setDocumentation(field.getDocumentation() == null ? note : field.getDocumentation() + " · " + note);
                    return field;
                }

                XSParticle particle = complex.getParticle();
                if (particle != null) {
                    typeStack.add(typeDef);
                    try {
                        field.getChildren().addAll(mapParticleChildren(particle, xpath, null, depth + 1, typeStack));
                    } finally {
                        typeStack.remove(typeDef);
                    }
                }
            }
        } else {
            XSSimpleTypeDefinition simple = (XSSimpleTypeDefinition) typeDef;
            field.setComplex(false);
            applySimpleTypeMetadata(field, simple);
        }

        return field;
    }

    private List<SchemaField> mapAttributes(XSComplexTypeDefinition complex) {
        List<SchemaField> attrs = new ArrayList<>();
        XSObjectList uses = complex.getAttributeUses();
        if (uses == null) {
            return attrs;
        }
        for (int i = 0; i < uses.getLength(); i++) {
            Object item = uses.item(i);
            if (!(item instanceof XSAttributeUse use)) {
                continue;
            }
            XSAttributeDeclaration decl = use.getAttrDeclaration();
            if (decl == null) {
                continue;
            }
            SchemaField attr = new SchemaField();
            attr.setName(decl.getName());
            attr.setNamespace(decl.getNamespace());
            attr.setAttribute(true);
            attr.setRequired(use.getRequired());
            attr.setMinOccurs(use.getRequired() ? 1 : 0);
            attr.setMaxOccurs(1);
            attr.setXpath("@" + decl.getName());
            XSTypeDefinition attrType = decl.getTypeDefinition();
            if (attrType instanceof XSSimpleTypeDefinition simple) {
                applySimpleTypeMetadata(attr, simple);
            } else {
                attr.setType("string");
            }
            attrs.add(attr);
        }
        return attrs;
    }

    private void applySimpleTypeMetadata(SchemaField field, XSSimpleTypeDefinition simple) {
        field.setType(mapSimpleType(simple));
        field.setTypeName(simple != null && simple.getName() != null ? simple.getName() : field.getType());
        field.setEnumerations(extractEnumerations(simple));
        applyFacets(field, simple);
        // decimal with fractionDigits=0 must be emitted as a whole number (e.g. SeqNb)
        if ("decimal".equals(field.getType())
                && field.getFractionDigits() != null
                && field.getFractionDigits() == 0) {
            field.setType("integer");
        }
    }

    private void applyFacets(SchemaField field, XSSimpleTypeDefinition simple) {
        if (simple == null) {
            return;
        }
        // Walk restriction chain so patterns/lengths on base types are captured
        XSSimpleTypeDefinition current = simple;
        while (current != null) {
            StringList patterns = current.getLexicalPattern();
            if (patterns != null && patterns.getLength() > 0 && field.getPattern() == null) {
                String p = patterns.item(0);
                if (p != null && !p.isBlank()) {
                    field.setPattern(p);
                }
            }

            short facets = current.getDefinedFacets();
            if ((facets & XSSimpleTypeDefinition.FACET_LENGTH) != 0 && field.getLength() == null) {
                field.setLength(parseIntFacet(current.getLexicalFacetValue(XSSimpleTypeDefinition.FACET_LENGTH)));
            }
            if ((facets & XSSimpleTypeDefinition.FACET_MINLENGTH) != 0 && field.getMinLength() == null) {
                field.setMinLength(parseIntFacet(current.getLexicalFacetValue(XSSimpleTypeDefinition.FACET_MINLENGTH)));
            }
            if ((facets & XSSimpleTypeDefinition.FACET_MAXLENGTH) != 0 && field.getMaxLength() == null) {
                field.setMaxLength(parseIntFacet(current.getLexicalFacetValue(XSSimpleTypeDefinition.FACET_MAXLENGTH)));
            }
            if ((facets & XSSimpleTypeDefinition.FACET_FRACTIONDIGITS) != 0 && field.getFractionDigits() == null) {
                field.setFractionDigits(parseIntFacet(
                        current.getLexicalFacetValue(XSSimpleTypeDefinition.FACET_FRACTIONDIGITS)));
            }
            if ((facets & XSSimpleTypeDefinition.FACET_TOTALDIGITS) != 0 && field.getTotalDigits() == null) {
                field.setTotalDigits(parseIntFacet(
                        current.getLexicalFacetValue(XSSimpleTypeDefinition.FACET_TOTALDIGITS)));
            }

            XSTypeDefinition base = current.getBaseType();
            if (!(base instanceof XSSimpleTypeDefinition) || base == current) {
                break;
            }
            current = (XSSimpleTypeDefinition) base;
            if (XSD_NS.equals(current.getNamespace())) {
                // Still read facets from the built-in decimal/integer base if useful, then stop
                short baseFacets = current.getDefinedFacets();
                if ((baseFacets & XSSimpleTypeDefinition.FACET_FRACTIONDIGITS) != 0
                        && field.getFractionDigits() == null) {
                    field.setFractionDigits(parseIntFacet(
                            current.getLexicalFacetValue(XSSimpleTypeDefinition.FACET_FRACTIONDIGITS)));
                }
                break;
            }
        }
    }

    private Integer parseIntFacet(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private List<SchemaField> mapParticleChildren(XSParticle particle, String parentXpath, String choiceGroup,
                                                   int depth, Set<XSTypeDefinition> typeStack) {
        List<SchemaField> children = new ArrayList<>();
        XSTerm term = particle.getTerm();
        if (term == null) {
            return children;
        }

        if (term instanceof XSModelGroup group) {
            boolean isChoice = group.getCompositor() == XSModelGroup.COMPOSITOR_CHOICE;
            String groupId = isChoice
                    ? (choiceGroup != null ? choiceGroup : "choice-" + choiceCounter.incrementAndGet())
                    : choiceGroup;

            XSObjectList particles = group.getParticles();
            for (int i = 0; i < particles.getLength(); i++) {
                XSParticle childParticle = (XSParticle) particles.item(i);
                if (isChoice) {
                    List<SchemaField> mapped = mapParticleChildren(childParticle, parentXpath, null, depth, typeStack);
                    for (SchemaField bf : mapped) {
                        bf.setChoiceGroup(groupId);
                        bf.setChoiceBranch(i);
                        // Alternatives are mutually exclusive — don't mark all as HTML-required
                        bf.setRequired(false);
                    }
                    children.addAll(mapped);
                } else {
                    children.addAll(mapParticleChildren(childParticle, parentXpath, groupId, depth, typeStack));
                }
            }
        } else if (term instanceof XSElementDeclaration childElement) {
            int min = particle.getMinOccurs();
            int max = particle.getMaxOccursUnbounded() ? -1 : particle.getMaxOccurs();
            String childXpath = parentXpath + "/" + childElement.getName();
            SchemaField child = mapElement(
                    childElement, childXpath, min, max == Integer.MAX_VALUE ? -1 : max, depth, typeStack);
            if (choiceGroup != null) {
                child.setChoiceGroup(choiceGroup);
                child.setRequired(false);
            }
            children.add(child);
        } else if (term instanceof XSWildcard) {
            int min = particle.getMinOccurs();
            int max = particle.getMaxOccursUnbounded() ? -1 : particle.getMaxOccurs();
            SchemaField any = new SchemaField();
            // Concrete element name used to satisfy xs:any (lax/skip) during generation
            any.setName("UsrData");
            any.setType("any");
            any.setTypeName("xs:any");
            any.setWildcard(true);
            any.setComplex(false);
            any.setMinOccurs(min);
            any.setMaxOccurs(max == Integer.MAX_VALUE ? -1 : max);
            any.setRequired(min >= 1);
            any.setXpath(parentXpath + "/*");
            if (choiceGroup != null) {
                any.setChoiceGroup(choiceGroup);
                any.setRequired(false);
            }
            children.add(any);
        }

        return children;
    }

    private String mapSimpleType(XSSimpleTypeDefinition simple) {
        if (simple == null) {
            return "string";
        }

        List<String> enums = extractEnumerations(simple);
        if (!enums.isEmpty()) {
            return "enumeration";
        }

        String builtIn = resolveBuiltInName(simple);
        return switch (builtIn) {
            case "boolean" -> "boolean";
            case "int", "integer", "long", "short", "byte", "nonNegativeInteger",
                 "positiveInteger", "nonPositiveInteger", "negativeInteger",
                 "unsignedInt", "unsignedLong", "unsignedShort", "unsignedByte" -> "integer";
            case "decimal", "float", "double" -> "decimal";
            case "date" -> "date";
            case "dateTime" -> "dateTime";
            case "time" -> "time";
            case "gYearMonth" -> "gYearMonth";
            case "gYear" -> "gYear";
            case "gMonth" -> "gMonth";
            case "gDay" -> "gDay";
            default -> "string";
        };
    }

    private String resolveBuiltInName(XSSimpleTypeDefinition simple) {
        XSSimpleTypeDefinition current = simple;
        while (current != null) {
            if (XSD_NS.equals(current.getNamespace()) && current.getName() != null) {
                return current.getName();
            }
            XSTypeDefinition base = current.getBaseType();
            if (!(base instanceof XSSimpleTypeDefinition) || base == current) {
                break;
            }
            current = (XSSimpleTypeDefinition) base;
        }
        return simple.getName() != null ? simple.getName() : "string";
    }

    private String resolveTypeName(XSTypeDefinition typeDef) {
        if (typeDef.getName() != null) {
            return typeDef.getName();
        }
        return "complex";
    }

    private List<String> extractEnumerations(XSSimpleTypeDefinition simple) {
        List<String> values = new ArrayList<>();
        if (simple == null) {
            return values;
        }

        // Enumerations can be on this type or a base restriction
        XSSimpleTypeDefinition current = simple;
        while (current != null && values.isEmpty()) {
            StringList enums = current.getLexicalEnumeration();
            if (enums != null) {
                for (int i = 0; i < enums.getLength(); i++) {
                    String value = enums.item(i);
                    if (value != null && !value.isBlank()) {
                        values.add(value);
                    }
                }
            }
            XSTypeDefinition base = current.getBaseType();
            if (!(base instanceof XSSimpleTypeDefinition) || base == current) {
                break;
            }
            current = (XSSimpleTypeDefinition) base;
            if (XSD_NS.equals(current.getNamespace())) {
                break;
            }
        }
        return values;
    }

    private String extractDocumentation(XSObjectList annotations) {
        if (annotations == null || annotations.getLength() == 0) {
            return null;
        }
        for (int i = 0; i < annotations.getLength(); i++) {
            XSAnnotation annotation = (XSAnnotation) annotations.item(i);
            if (annotation != null) {
                String raw = annotation.getAnnotationString();
                if (raw != null && !raw.isBlank()) {
                    String stripped = raw.replaceAll("(?s)<[^>]*>", " ").replaceAll("\\s+", " ").trim();
                    if (!stripped.isEmpty()) {
                        return stripped;
                    }
                }
            }
        }
        return null;
    }

    public record ParsedSchema(String schemaId, String fileName, List<SchemaField> roots) {
    }

    private record StoredSchema(
            String fileName,
            byte[] bytes,
            Map<String, byte[]> files,
            List<SchemaField> roots
    ) {
    }

    /**
     * Resolves xs:import / xs:include against files uploaded in the same ZIP (or the primary XSD).
     */
    private static final class MapLsResourceResolver implements LSResourceResolver {
        private final Map<String, byte[]> filesByName;
        private final String primaryName;

        MapLsResourceResolver(Map<String, byte[]> files, String primaryName) {
            this.filesByName = new HashMap<>();
            if (files != null) {
                for (Map.Entry<String, byte[]> e : files.entrySet()) {
                    this.filesByName.put(basename(e.getKey()).toLowerCase(Locale.ROOT), e.getValue());
                    this.filesByName.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue());
                }
            }
            this.primaryName = primaryName;
        }

        @Override
        public LSInput resolveResource(String type, String namespaceURI, String publicId,
                                       String systemId, String baseURI) {
            byte[] data = find(systemId);
            if (data == null && primaryName != null) {
                data = find(primaryName);
            }
            if (data == null) {
                return null;
            }
            return new ByteArrayLSInput(data, systemId != null ? basename(systemId) : primaryName);
        }

        private byte[] find(String systemId) {
            if (systemId == null || systemId.isBlank()) {
                return null;
            }
            String base = basename(systemId).toLowerCase(Locale.ROOT);
            byte[] data = filesByName.get(base);
            if (data != null) {
                return data;
            }
            return filesByName.get(systemId.toLowerCase(Locale.ROOT));
        }

        private static String basename(String path) {
            String p = path.replace('\\', '/');
            int slash = p.lastIndexOf('/');
            return slash >= 0 ? p.substring(slash + 1) : p;
        }
    }

    private static final class MapXmlEntityResolver implements org.apache.xerces.xni.parser.XMLEntityResolver {
        private final Map<String, byte[]> filesByName;

        MapXmlEntityResolver(Map<String, byte[]> files, String primaryName) {
            this.filesByName = new HashMap<>();
            if (files != null) {
                for (Map.Entry<String, byte[]> e : files.entrySet()) {
                    this.filesByName.put(basename(e.getKey()).toLowerCase(Locale.ROOT), e.getValue());
                }
            }
            if (primaryName != null && files != null && files.containsKey(primaryName)) {
                this.filesByName.put(basename(primaryName).toLowerCase(Locale.ROOT), files.get(primaryName));
            }
        }

        @Override
        public org.apache.xerces.xni.parser.XMLInputSource resolveEntity(
                org.apache.xerces.xni.XMLResourceIdentifier resourceIdentifier) {
            String systemId = resourceIdentifier != null ? resourceIdentifier.getLiteralSystemId() : null;
            if (systemId == null && resourceIdentifier != null) {
                systemId = resourceIdentifier.getExpandedSystemId();
            }
            if (systemId == null) {
                return null;
            }
            byte[] data = filesByName.get(basename(systemId).toLowerCase(Locale.ROOT));
            if (data == null) {
                return null;
            }
            org.apache.xerces.xni.parser.XMLInputSource src = new org.apache.xerces.xni.parser.XMLInputSource(
                    resourceIdentifier != null ? resourceIdentifier.getPublicId() : null,
                    basename(systemId),
                    resourceIdentifier != null ? resourceIdentifier.getBaseSystemId() : null);
            src.setByteStream(new ByteArrayInputStream(data));
            return src;
        }

        private static String basename(String path) {
            String p = path.replace('\\', '/');
            int slash = p.lastIndexOf('/');
            return slash >= 0 ? p.substring(slash + 1) : p;
        }
    }

    private static final class CollectingErrorHandler implements ErrorHandler {
        private final List<String> errors;

        CollectingErrorHandler(List<String> errors) {
            this.errors = errors;
        }

        @Override
        public void warning(SAXParseException exception) {
            // Ignore warnings; fail only on errors/fatal errors
        }

        @Override
        public void error(SAXParseException exception) {
            errors.add(format(exception));
        }

        @Override
        public void fatalError(SAXParseException exception) {
            errors.add(format(exception));
        }

        private String format(SAXParseException ex) {
            StringBuilder sb = new StringBuilder();
            if (ex.getLineNumber() > 0) {
                sb.append("line ").append(ex.getLineNumber());
                if (ex.getColumnNumber() > 0) {
                    sb.append(":").append(ex.getColumnNumber());
                }
                sb.append(" — ");
            }
            sb.append(ex.getMessage() != null ? ex.getMessage() : "Validation error");
            return sb.toString();
        }
    }

    private static final class ByteArrayLSInput implements LSInput {
        private final byte[] data;
        private String systemId;
        private String publicId;
        private String baseURI;
        private String encoding = "UTF-8";
        private boolean certifiedText;

        ByteArrayLSInput(byte[] data, String systemId) {
            this.data = data;
            this.systemId = systemId;
        }

        @Override
        public Reader getCharacterStream() {
            return null;
        }

        @Override
        public void setCharacterStream(Reader characterStream) {
        }

        @Override
        public InputStream getByteStream() {
            return new ByteArrayInputStream(data);
        }

        @Override
        public void setByteStream(InputStream byteStream) {
        }

        @Override
        public String getStringData() {
            return new String(data, StandardCharsets.UTF_8);
        }

        @Override
        public void setStringData(String stringData) {
        }

        @Override
        public String getSystemId() {
            return systemId;
        }

        @Override
        public void setSystemId(String systemId) {
            this.systemId = systemId;
        }

        @Override
        public String getPublicId() {
            return publicId;
        }

        @Override
        public void setPublicId(String publicId) {
            this.publicId = publicId;
        }

        @Override
        public String getBaseURI() {
            return baseURI;
        }

        @Override
        public void setBaseURI(String baseURI) {
            this.baseURI = baseURI;
        }

        @Override
        public String getEncoding() {
            return encoding;
        }

        @Override
        public void setEncoding(String encoding) {
            this.encoding = encoding;
        }

        @Override
        public boolean getCertifiedText() {
            return certifiedText;
        }

        @Override
        public void setCertifiedText(boolean certifiedText) {
            this.certifiedText = certifiedText;
        }
    }
}
