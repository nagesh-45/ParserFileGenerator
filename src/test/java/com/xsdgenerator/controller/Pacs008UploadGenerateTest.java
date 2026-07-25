package com.xsdgenerator.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-level test mirroring the browser: upload pacs.008.001.05 → generate with empty Document values.
 */
@SpringBootTest
@AutoConfigureMockMvc
class Pacs008UploadGenerateTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void uploadAndGenerate_pacs008_001_05_succeeds() throws Exception {
        byte[] xsd = Files.readAllBytes(Path.of("samples/pacs.008.001.05.xsd"));
        MockMultipartFile file = new MockMultipartFile(
                "file", "pacs.008.001.05.xsd", "application/xml", xsd);

        MvcResult upload = mockMvc.perform(multipart("/upload-xsd").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.documentChildCount").value(1))
                .andExpect(jsonPath("$.documentChildNames[0]").value("FIToFICstmrCdtTrf"))
                .andReturn();

        String uploadBody = upload.getResponse().getContentAsString();
        String schemaId = uploadBody.replaceAll("(?s).*\"schemaId\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        assertTrue(schemaId.length() > 8, "schemaId missing in: " + uploadBody);

        // Same payload shape as app.js buildPayload() when the form is empty
        String payload = """
                {
                  "schemaId": "%s",
                  "rootName": "Document",
                  "schema": { "name": "Document" },
                  "values": { "Document": {} }
                }
                """.formatted(schemaId);

        MvcResult generate = mockMvc.perform(post("/generate-xml")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.validated").value(true))
                .andReturn();

        String xml = generate.getResponse().getContentAsString();
        assertTrue(xml.contains("FIToFICstmrCdtTrf"),
                "Response missing FIToFICstmrCdtTrf: " + xml.substring(0, Math.min(500, xml.length())));
        assertTrue(!xml.contains("cvc-complex-type"), "Should not return validation errors: " + xml);
    }
}
