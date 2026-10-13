# E-book converter

Simple script that takes input from Markdown files and converts them into e-book in following formats:
- EPUB
- PDF
- DOCX
- TXT

## Requirements

- LibreOffice, with the `soffice` executable available on your `PATH`
- [DocTML](https://github.com/kildom/xml2docx/tree/dev-v0.1.0), with the `doctml` executable available on your `PATH`

## Usage

Run the converter with an input directory and an output name without an extension. Add `--debug` to write intermediate files to `<output-name>.debug`:

```sh
npx tsx src/convert.ts <input-directory> <output-name> [--debug]
```

For example, `npx tsx src/convert.ts ./tekst ./dist/book` generates `book.epub`, `book.pdf`, `book.docx`, and `book.txt` in `./dist`. With `--debug`, it also writes the mdast JSON, source DoctML, and unpacked EPUB files to `./dist/book.debug`.
