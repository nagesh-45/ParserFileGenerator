package com.xsdgenerator.service;

import com.xsdgenerator.dto.SchemaField;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

class TimeNormalizationTest {

    @Test
    void htmlTimeWithoutSeconds_isPaddedForXsTime() {
        String xsd = """
                <?xml version="1.0" encoding="UTF-8"?>
                <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                           targetNamespace="urn:test:time"
                           xmlns="urn:test:time"
                           elementFormDefault="qualified">
                  <xs:element name="Document">
                    <xs:complexType>
                      <xs:sequence>
                        <xs:element name="CLSTm" type="xs:time"/>
                        <xs:element name="TillTm" type="xs:time"/>
                      </xs:sequence>
                    </xs:complexType>
                  </xs:element>
                </xs:schema>
                """;
        XsdParserService service = new XsdParserService();
        var parsed = service.parseAndStoreUpload(xsd.getBytes(StandardCharsets.UTF_8), "time.xsd");
        SchemaField stub = new SchemaField();
        stub.setName("Document");
        Map<String, Object> values = new LinkedHashMap<>();
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("CLSTm", "22:26");
        doc.put("TillTm", "07:29");
        values.put("Document", doc);

        String xml = service.generateAndValidateXml(parsed.schemaId(), stub, values);
        assertTrue(xml.contains("<CLSTm>22:26:00</CLSTm>"), xml);
        assertTrue(xml.contains("<TillTm>07:29:00</TillTm>"), xml);
    }
}
