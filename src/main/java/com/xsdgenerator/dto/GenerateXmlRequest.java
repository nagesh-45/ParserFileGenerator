package com.xsdgenerator.dto;

import java.util.Map;

/**
 * Request body for XML generation and download endpoints.
 */
public class GenerateXmlRequest {

    private String schemaId;
    /** Optional; preferred over embedding the full schema tree for large XSDs like pacs.008. */
    private String rootName;
    private SchemaField schema;
    private Map<String, Object> values;

    public String getSchemaId() {
        return schemaId;
    }

    public void setSchemaId(String schemaId) {
        this.schemaId = schemaId;
    }

    public String getRootName() {
        return rootName;
    }

    public void setRootName(String rootName) {
        this.rootName = rootName;
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
