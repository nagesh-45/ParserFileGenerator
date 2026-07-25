package com.xsdgenerator.dto;

import java.util.Map;

/**
 * Request body for XML generation and download endpoints.
 */
public class GenerateXmlRequest {

    private String schemaId;
    private SchemaField schema;
    private Map<String, Object> values;

    public String getSchemaId() {
        return schemaId;
    }

    public void setSchemaId(String schemaId) {
        this.schemaId = schemaId;
    }

    public SchemaField getSchema() {
        return schema;
    }

    public void setSchema(SchemaField schema) {
        this.schema = schema;
    }

    public Map<String, Object> getValues() {
        return values;
    }

    public void setValues(Map<String, Object> values) {
        this.values = values;
    }
}
