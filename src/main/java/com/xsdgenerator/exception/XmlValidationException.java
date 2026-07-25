package com.xsdgenerator.exception;

import java.util.ArrayList;
import java.util.List;

/**
 * Thrown when generated XML fails validation against the uploaded XSD.
 */
public class XmlValidationException extends RuntimeException {

    private final List<String> errors;

    public XmlValidationException(String message, List<String> errors) {
        super(message);
        this.errors = errors != null ? List.copyOf(errors) : List.of();
    }

    public List<String> getErrors() {
        return new ArrayList<>(errors);
    }
}
