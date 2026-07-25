# ParserFile Generator (XSD → XML)

Spring Boot web app that uploads an XSD, builds a dynamic form from the schema, and generates a formatted XML file.

Repository: [nagesh-45/ParserFileGenerator](https://github.com/nagesh-45/ParserFileGenerator)

## Requirements

- To build from source: Java 17+ and Maven 3.8+
- To run the packaged application: Java 17+ only

## Build and run

```bash
git clone https://github.com/nagesh-45/ParserFileGenerator.git
cd ParserFileGenerator
mvn clean package
java -jar target/payment-file-creator.jar
```

Open [http://localhost:8080](http://localhost:8080).

## Run on a Java-only laptop

Build the application once on a development machine, then copy
`target/payment-file-creator.jar` to the other laptop. Run:

```bash
java -jar payment-file-creator.jar
```

The executable JAR contains Spring Boot, Xerces, Thymeleaf, and the frontend
assets. Maven, Node.js, and an internet connection are not required at runtime.

## Workflow

1. Upload an `.xsd` file (try `samples/payment.xsd`).
2. Choose how to provide values:
   - **Enter values manually** — fill the form yourself
   - **Generate with random valid values** — auto-fill type-safe sample data (you can still edit)
3. Optionally set:
   - **Include optional tags**
   - **Country code** (e.g. `HK` → fills country/`Ccy` with `HK`/`HKD`)
   - **CdtrAgt / DbtrAgt / DbtrAcct / CdtrAcct** payment values
4. Click **Generate & Validate XML** — the backend builds the XML and validates it against the **same uploaded XSD**.
5. On success, preview the XML; on failure, see the XSD validation error list.
6. Click **Download XML File** (also re-validates before download).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Thymeleaf UI |
| `POST` | `/upload-xsd` | Multipart XSD upload → schema JSON + `schemaId` |
| `POST` | `/generate-xml` | Form values + schema → XML string (validated vs uploaded XSD) |
| `POST` | `/download-xml` | Same payload → downloadable `.xml` (validated vs uploaded XSD) |

Validation failures return HTTP 400 with:

```json
{
  "success": false,
  "validated": false,
  "message": "Generated XML is not valid against the uploaded XSD (N error(s))",
  "errors": ["line 5:12 — cvc-datatype-valid.1.2.1: 'abc' is not a valid value for 'decimal'."]
}
```

## Project Layout

```
src/main/java/com/xsdgenerator/
  XsdGeneratorApplication.java
  controller/XsdController.java
  dto/SchemaField.java
  dto/GenerateXmlRequest.java
  service/XsdParserService.java
src/main/resources/
  application.properties
  static/app.js
  static/vendor/tailwindcss-3.4.17.js
  templates/index.html
samples/payment.xsd
pom.xml
```
