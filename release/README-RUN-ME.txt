Payment File Creator - ready to run
===================================

Requirement: Java 17 or newer. Nothing else. No internet needed.
Check your Java version by running:  java -version


HOW TO START
------------

Windows:
    Double-click  START-WINDOWS.bat

macOS / Linux:
    Double-click  START-MAC-LINUX.command
    (If it will not open, run this once in Terminal:
       chmod +x START-MAC-LINUX.command )

The browser opens automatically at http://localhost:8080
If it does not open, type that address into your browser yourself.

Keep the black console window OPEN while using the app.
To stop the app, press Ctrl+C in that window, or just close it.


IF DOUBLE-CLICK DOES NOT WORK
-----------------------------

Open a terminal / Command Prompt in this folder and run:

    java -jar payment-file-creator.jar

To use a different port (if 8080 is already taken):

    java -jar payment-file-creator.jar --server.port=9090

Then open http://localhost:9090


HOW TO USE THE APP
------------------

1. Upload an .xsd schema file (payment.xsd is included as a sample).
2. Choose "Enter values manually" or "Generate with random valid values".
3. Optional settings:
     - Include optional tags  (on/off)
     - Country code, e.g. HK   -> fills country as HK and currency as HKD
     - CdtrAgt / DbtrAgt / DbtrAcct / CdtrAcct values
4. Click "Generate & Validate XML".
   The XML is validated against the same XSD you uploaded.
5. Preview it, then click "Download XML File".


NOTE ON SECURITY WARNINGS
-------------------------

Windows SmartScreen or antivirus may warn about an unsigned Java app.
This is expected. Choose "More info" then "Run anyway" if you trust the source.
