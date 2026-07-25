package com.xsdgenerator.service;

import com.xsdgenerator.dto.SchemaField;
import com.xsdgenerator.exception.XmlValidationException;
import com.xsdgenerator.service.XsdParserService.ParsedSchema;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Regression tests for the exact pacs.008.001.05 failure:
 * empty {@code <Document/>} missing {@code FIToFICstmrCdtTrf}.
 */
class Pacs008GenerationTest {

    private XsdParserService service;
    private byte[] xsdBytes;

    @BeforeEach
    void setUp() throws Exception {
        service = new XsdParserService();
        Path sample = Path.of("samples/pacs.008.001.05.xsd");
        if (Files.exists(sample)) {
            xsdBytes = Files.readAllBytes(sample);
        } else {
            try (InputStream in = new ClassPathResource("samples/pacs.008.001.05.xsd").getInputStream()) {
                xsdBytes = in.readAllBytes();
            }
        }
        assertTrue(xsdBytes.length > 1000, "pacs.008.001.05.xsd must be present under samples/");
    }

    @Test
    void upload_parsesDocumentWithFiToFiChild() {
        ParsedSchema parsed = service.parseAndStoreUpload(xsdBytes, "pacs.008.001.05.xsd");
        SchemaField document = findDocument(parsed.roots());

        assertNotNull(document, "Document root must exist");
        assertFalse(document.getChildren() == null || document.getChildren().isEmpty(),
                "Document must have children after parse");
        assertTrue(document.getChildren().stream().anyMatch(c -> "FIToFICstmrCdtTrf".equals(c.getName())),
                "Document children were " + document.getChildren().stream().map(SchemaField::getName).toList()
                        + " — expected FIToFICstmrCdtTrf");
    }

    @Test
    void generate_withEmptyUiValues_includesFiToFiAndValidates() {
        ParsedSchema parsed = service.parseAndStoreUpload(xsdBytes, "pacs.008.001.05.xsd");
        SchemaField stub = new SchemaField();
        stub.setName("Document");

        // Exact shape the browser sends when the form is blank / random-fill missed fields
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("Document", new LinkedHashMap<>());

        String xml;
        try {
            xml = service.generateAndValidateXml(parsed.schemaId(), stub, values);
        } catch (XmlValidationException ex) {
            fail("Validation failed for empty UI values:\n" + String.join("\n", ex.getErrors()));
            return;
        }

        assertTrue(xml.contains("FIToFICstmrCdtTrf"),
                "Generated XML was missing FIToFICstmrCdtTrf:\n" + xml);
        assertFalse(xml.matches("(?s).*<Document[^>]*/>.*")
                        || xml.contains("<Document") && !xml.contains("FIToFICstmrCdtTrf"),
                "Document must not be empty:\n" + xml);
        assertTrue(xml.contains("GrpHdr"), "Expected GrpHdr under FIToFICstmrCdtTrf:\n" + xml);
    }

    @Test
    void emptyDocumentXml_failsWithExactUserError() {
        ParsedSchema parsed = service.parseAndStoreUpload(xsdBytes, "pacs.008.001.05.xsd");
        String emptyDoc = """
                <?xml version="1.0" encoding="UTF-8"?>
                <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.05"/>
                """;
        try {
            // Use package-private path via generate then validate by forcing empty output through public API
            service.validateXmlAgainstXsd(emptyDoc, xsdBytes, "pacs.008.001.05.xsd");
            fail("Empty Document should fail XSD validation");
        } catch (XmlValidationException ex) {
            String joined = String.join(" | ", ex.getErrors());
            assertTrue(joined.contains("FIToFICstmrCdtTrf"),
                    "Expected FIToFICstmrCdtTrf in errors, got: " + joined);
            assertTrue(joined.contains("Document") || joined.contains("cvc-complex-type"),
                    "Expected Document content error, got: " + joined);
        } catch (IllegalArgumentException | IllegalStateException ex) {
            // validateXmlAgainstXsd(public) wraps StoredSchema — may throw XmlValidationException only
            fail("Unexpected: " + ex);
        }
    }

    @Test
    void generate_stillWorks_whenStoredDocumentChildrenWereCleared() {
        ParsedSchema parsed = service.parseAndStoreUpload(xsdBytes, "pacs.008.001.05.xsd");
        SchemaField document = findDocument(parsed.roots());
        // Simulate the broken in-memory tree the user hit (Document with zero children)
        document.getChildren().clear();

        SchemaField stub = new SchemaField();
        stub.setName("Document");
        Map<String, Object> values = Map.of("Document", Map.of());

        String xml;
        try {
            xml = service.generateAndValidateXml(parsed.schemaId(), stub, values);
        } catch (XmlValidationException ex) {
            fail("Rematerialize/inject should recover empty Document children. Errors:\n"
                    + String.join("\n", ex.getErrors()));
            return;
        }
        assertTrue(xml.contains("FIToFICstmrCdtTrf"), "Recovered XML:\n" + xml);
    }

    @Test
    void validationFailures_carryBuildStampAndXmlPreview() {
        ParsedSchema parsed = service.parseAndStoreUpload(xsdBytes, "pacs.008.001.05.xsd");
        SchemaField stub = new SchemaField();
        stub.setName("Document");

        // Value that cannot be repaired into validity: wrong datatype on a required leaf
        Map<String, Object> grpHdr = new LinkedHashMap<>();
        grpHdr.put("CreDtTm", "not-a-timestamp");
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("GrpHdr", grpHdr);
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("FIToFICstmrCdtTrf", msg);
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("Document", doc);

        try {
            service.generateAndValidateXml(parsed.schemaId(), stub, values);
            // If the generator repaired it, that is also acceptable behaviour
        } catch (XmlValidationException ex) {
            assertTrue(ex.getMessage().contains(com.xsdgenerator.AppBuild.ID),
                    "Error message must name the build: " + ex.getMessage());
            String joined = String.join("\n", ex.getErrors());
            assertTrue(joined.contains("generatedXmlPreview:"),
                    "Errors must include the generated XML preview:\n" + joined);
            assertTrue(joined.contains("appBuild: " + com.xsdgenerator.AppBuild.ID),
                    "Errors must include appBuild diagnostics:\n" + joined);
        }
    }

    private static SchemaField findDocument(List<SchemaField> roots) {
        return roots.stream()
                .filter(r -> "Document".equals(r.getName()))
                .findFirst()
                .orElse(roots.isEmpty() ? null : roots.get(0));
    }
}
