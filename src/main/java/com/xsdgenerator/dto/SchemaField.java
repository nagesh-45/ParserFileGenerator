package com.xsdgenerator.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * Recursive DTO describing one XSD element/attribute for dynamic form rendering and XML generation.
 */
public class SchemaField {

    private String name;
    private String type;
    private String typeName;
    private String namespace;
    private String xpath;
    private boolean required;
    private int minOccurs = 1;
    private int maxOccurs = 1;
    private boolean complex;
    private boolean attribute;
    private List<String> enumerations = new ArrayList<>();
    private List<SchemaField> children = new ArrayList<>();
    private List<SchemaField> attributes = new ArrayList<>();
    private String documentation;

    /** XSD pattern facet (first / most specific), if any. */
    private String pattern;
    private Integer minLength;
    private Integer maxLength;
    private Integer length;
    private Integer fractionDigits;
    private Integer totalDigits;

    /** True when this field represents an xs:any wildcard particle. */
    private boolean wildcard;

    /**
     * When set, siblings sharing the same choiceGroup are mutually exclusive (xs:choice).
     * Random generation / form submission should emit only one branch per group.
     */
    private String choiceGroup;

    /**
     * Distinguishes alternatives when a choice branch expands to multiple elements
     * (choice of sequences). Fields with the same choiceGroup + choiceBranch belong together.
     */
    private Integer choiceBranch;

    /**
     * When true, this field is part of an xs:choice that itself has minOccurs &gt;= 1,
     * so exactly one branch must appear in the XML.
     */
    private boolean choiceMandatory;

    public SchemaField() {
    }

    public SchemaField(String name, String type) {
        this.name = name;
        this.type = type;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getTypeName() {
        return typeName;
    }

    public void setTypeName(String typeName) {
        this.typeName = typeName;
    }

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public String getXpath() {
        return xpath;
    }

    public void setXpath(String xpath) {
        this.xpath = xpath;
    }

    public boolean isRequired() {
        return required;
    }

    public void setRequired(boolean required) {
        this.required = required;
    }

    public int getMinOccurs() {
        return minOccurs;
    }

    public void setMinOccurs(int minOccurs) {
        this.minOccurs = minOccurs;
    }

    public int getMaxOccurs() {
        return maxOccurs;
    }

    public void setMaxOccurs(int maxOccurs) {
        this.maxOccurs = maxOccurs;
    }

    public boolean isComplex() {
        return complex;
    }

    public void setComplex(boolean complex) {
        this.complex = complex;
    }

    public boolean isAttribute() {
        return attribute;
    }

    public void setAttribute(boolean attribute) {
        this.attribute = attribute;
    }

    public List<String> getEnumerations() {
        return enumerations;
    }

    public void setEnumerations(List<String> enumerations) {
        this.enumerations = enumerations != null ? enumerations : new ArrayList<>();
    }

    public List<SchemaField> getChildren() {
        return children;
    }

    public void setChildren(List<SchemaField> children) {
        this.children = children != null ? children : new ArrayList<>();
    }

    public List<SchemaField> getAttributes() {
        return attributes;
    }

    public void setAttributes(List<SchemaField> attributes) {
        this.attributes = attributes != null ? attributes : new ArrayList<>();
    }

    public String getDocumentation() {
        return documentation;
    }

    public void setDocumentation(String documentation) {
        this.documentation = documentation;
    }

    public String getPattern() {
        return pattern;
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
    }

    public Integer getMinLength() {
        return minLength;
    }

    public void setMinLength(Integer minLength) {
        this.minLength = minLength;
    }

    public Integer getMaxLength() {
        return maxLength;
    }

    public void setMaxLength(Integer maxLength) {
        this.maxLength = maxLength;
    }

    public Integer getLength() {
        return length;
    }

    public void setLength(Integer length) {
        this.length = length;
    }

    public Integer getFractionDigits() {
        return fractionDigits;
    }

    public void setFractionDigits(Integer fractionDigits) {
        this.fractionDigits = fractionDigits;
    }

    public Integer getTotalDigits() {
        return totalDigits;
    }

    public void setTotalDigits(Integer totalDigits) {
        this.totalDigits = totalDigits;
    }

    public boolean isWildcard() {
        return wildcard;
    }

    public void setWildcard(boolean wildcard) {
        this.wildcard = wildcard;
    }

    public String getChoiceGroup() {
        return choiceGroup;
    }

    public void setChoiceGroup(String choiceGroup) {
        this.choiceGroup = choiceGroup;
    }

    public Integer getChoiceBranch() {
        return choiceBranch;
    }

    public void setChoiceBranch(Integer choiceBranch) {
        this.choiceBranch = choiceBranch;
    }

    public boolean isChoiceMandatory() {
        return choiceMandatory;
    }

    public void setChoiceMandatory(boolean choiceMandatory) {
        this.choiceMandatory = choiceMandatory;
    }

    public boolean isUnbounded() {
        return maxOccurs == -1;
    }

    public boolean isRepeatable() {
        return maxOccurs == -1 || maxOccurs > 1;
    }

    public boolean hasAttributes() {
        return attributes != null && !attributes.isEmpty();
    }
}
