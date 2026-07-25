package com.xsdgenerator.controller;

import com.xsdgenerator.dto.GenerateXmlRequest;
import com.xsdgenerator.exception.XmlValidationException;
import com.xsdgenerator.service.XsdParserService;
import com.xsdgenerator.service.XsdParserService.ParsedSchema;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

@Controller
public class XsdController {

    private final XsdParserService xsdParserService;

    public XsdController(XsdParserService xsdParserService) {
        this.xsdParserService = xsdParserService;
    }

    @GetMapping("/")
    public String index() {
        return "index";
    }

    @GetMapping(value = "/version", produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public Map<String, Object> version() {
        Map<String, Object> body = new HashMap<>();
        body.put("buildId", com.xsdgenerator.AppBuild.ID);
        return body;
    }

    @PostMapping(value = "/upload-xsd", produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public ResponseEntity<Map<String, Object>> uploadXsd(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(error("Please select a non-empty .xsd or .zip file"));
        }

        String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "schema.xsd";
        // Browsers / OS may send a full path or odd casing; normalize to the basename.
        originalName = originalName.replace('\\', '/');
        int slash = originalName.lastIndexOf('/');
        if (slash >= 0 && slash < originalName.length() - 1) {
            originalName = originalName.substring(slash + 1);
        }

        String lower = originalName.toLowerCase();
        boolean looksLikeSchema = lower.endsWith(".xsd") || lower.endsWith(".xml") || lower.endsWith(".zip");
        // Some pickers strip extensions or report blank names — fall back to content sniff.
        if (!looksLikeSchema) {
            String contentType = file.getContentType() != null ? file.getContentType().toLowerCase() : "";
            boolean xmlMime = contentType.contains("xml") || contentType.contains("xsd")
                    || contentType.contains("zip")
                    || contentType.equals("application/octet-stream") || contentType.isBlank();
            if (xmlMime) {
                originalName = originalName.isBlank() || !originalName.contains(".")
                        ? "schema.xsd"
                        : originalName + (contentType.contains("zip") ? ".zip" : ".xsd");
                looksLikeSchema = true;
            }
        }
        if (!looksLikeSchema) {
            return ResponseEntity.badRequest().body(error(
                    "Only .xsd / schema .xml / .zip (multi-file pacs schemas) are supported"));
        }

        try {
            ParsedSchema parsed = xsdParserService.parseAndStoreUpload(file.getBytes(), originalName);
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("schemaId", parsed.schemaId());
            response.put("fileName", parsed.fileName());
            response.put("roots", parsed.roots());
            response.put("rootCount", parsed.roots().size());
            response.put("buildId", com.xsdgenerator.AppBuild.ID);
            if (!parsed.roots().isEmpty()) {
                var doc = parsed.roots().stream()
                        .filter(r -> "Document".equals(r.getName()))
                        .findFirst()
                        .orElse(parsed.roots().get(0));
                response.put("rootName", doc.getName());
                response.put("documentChildCount",
                        doc.getChildren() != null ? doc.getChildren().size() : 0);
                response.put("documentChildNames",
                        doc.getChildren() == null ? java.util.List.of()
                                : doc.getChildren().stream().map(c -> c.getName()).toList());
            }
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(error(ex.getMessage()));
        } catch (Exception ex) {
            return ResponseEntity.internalServerError()
                    .body(error("Failed to parse XSD: " + ex.getMessage()
                            + (ex.getCause() != null && ex.getCause().getMessage() != null
                            ? " (" + ex.getCause().getMessage() + ")" : "")));
        }
    }

    @PostMapping(value = "/generate-xml", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public ResponseEntity<Map<String, Object>> generateXml(@RequestBody GenerateXmlRequest request) {
        try {
            validateGenerateRequest(request);
            String xml = xsdParserService.generateAndValidateXml(
                    request.getSchemaId(), resolveClientSchema(request), request.getValues());
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("validated", true);
            response.put("xml", xml);
            response.put("message", "XML generated and validated successfully against the uploaded XSD");
            return ResponseEntity.ok(response);
        } catch (XmlValidationException ex) {
            return ResponseEntity.badRequest().body(validationError(ex));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(error(ex.getMessage()));
        } catch (Exception ex) {
            return ResponseEntity.internalServerError()
                    .body(error("Failed to generate XML: " + ex.getMessage()));
        }
    }

    @PostMapping(value = "/download-xml", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public ResponseEntity<?> downloadXml(@RequestBody GenerateXmlRequest request) {
        try {
            validateGenerateRequest(request);
            String xml = xsdParserService.generateAndValidateXml(
                    request.getSchemaId(), resolveClientSchema(request), request.getValues());
            String rootName = resolveRootName(request);
            String fileName = rootName.replaceAll("[^a-zA-Z0-9._-]", "_") + ".xml";

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                    .contentType(MediaType.APPLICATION_XML)
                    .body(xml.getBytes(StandardCharsets.UTF_8));
        } catch (XmlValidationException ex) {
            return ResponseEntity.badRequest()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(validationError(ex));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(error(ex.getMessage()));
        }
    }

    private void validateGenerateRequest(GenerateXmlRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Request body is required");
        }
        if (request.getSchemaId() == null || request.getSchemaId().isBlank()) {
            throw new IllegalArgumentException("schemaId is required. Please upload the XSD again.");
        }
        if (resolveRootName(request).isBlank()) {
            throw new IllegalArgumentException("Root element name is missing from schema metadata");
        }
    }

    private com.xsdgenerator.dto.SchemaField resolveClientSchema(GenerateXmlRequest request) {
        if (request.getSchema() != null && request.getSchema().getName() != null
                && !request.getSchema().getName().isBlank()) {
            return request.getSchema();
        }
        com.xsdgenerator.dto.SchemaField stub = new com.xsdgenerator.dto.SchemaField();
        stub.setName(resolveRootName(request));
        return stub;
    }

    private String resolveRootName(GenerateXmlRequest request) {
        if (request.getRootName() != null && !request.getRootName().isBlank()) {
            return request.getRootName();
        }
        if (request.getSchema() != null && request.getSchema().getName() != null) {
            return request.getSchema().getName();
        }
        return "";
    }

    private Map<String, Object> error(String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("success", false);
        body.put("validated", false);
        body.put("message", message);
        return body;
    }

    private Map<String, Object> validationError(XmlValidationException ex) {
        Map<String, Object> body = error(ex.getMessage());
        body.put("errors", ex.getErrors());
        body.put("buildId", com.xsdgenerator.AppBuild.ID);
        return body;
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseBody
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(error(ex.getMessage()));
    }

    @ExceptionHandler(XmlValidationException.class)
    @ResponseBody
    public ResponseEntity<Map<String, Object>> handleValidation(XmlValidationException ex) {
        return ResponseEntity.badRequest().body(validationError(ex));
    }
}
