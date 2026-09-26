# Use the built-in Windows OCR engine for text recognition

Glance makes scanned PDFs and photos of text searchable and selectable (like Apple's Live Text) using `Windows.Media.Ocr`, called from Rust through the `windows` crate. It is free, ships with Windows 10/11, and adds no install size or model download. The trade-off: it only works on Windows, and only for the OCR languages installed in Windows settings. Tesseract was rejected because it adds tens of MB of language data.
