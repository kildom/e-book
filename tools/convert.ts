import fs from "node:fs";
import path from "node:path";
import { execFileSync } from 'node:child_process';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkDirective from 'remark-directive';
import { toString } from 'mdast-util-to-string';
import type { Root } from 'mdast';
import { unified } from 'unified';
import { ZipArchive } from 'archiver';
import { template } from 'underscore';

import { mdastToHtml } from './convert-html';
import { mdastToDocTML } from "./convert-doctml";
import { mdastToPlainText } from "./convert-txt";
import { mdastStats, type BookStats } from "./convert-stats";

declare module "unist" {
    interface Position {
        file: string;
    }
}
const SOURCE_DIR = './tekst';

interface BookMeta {
    title: string;
    subtitle: string;
    subtitle2: string;
    author: string;
    language: string;
    cover: string;
    bookid: string;
    tocTitle: string;
    afterTitlePage: Root | null;
};

interface Chapter {
    id: number;
    title: string;
    root: Root;
};

interface Book {
    meta: BookMeta;
    chapters: Chapter[];
};

function parseInput(): Book {

    function updateRootPositions(root: Root) {
        let first = root.children[0]?.position;
        let last = root.children.at(-1)?.position;
        if (first && last) {
            root.position = {
                start: JSON.parse(JSON.stringify(first.start)),
                end: JSON.parse(JSON.stringify(last.end)),
                file: first.file,
            };
        }
    }

    let book: Book = {
        meta: {
            title: '',
            subtitle: '',
            subtitle2: '',
            author: '',
            language: '',
            cover: '',
            bookid: '',
            tocTitle: '',
            afterTitlePage: null,
        },
        chapters: [],
    };


    let input = [...fs.readdirSync(SOURCE_DIR)]
        .filter(fileName => fileName.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b))
        .map(fileName => fs.readFileSync(`${SOURCE_DIR}/${fileName}`, 'utf-8').replace(/\r\n/g, '\n') + `\n\n::file{ name="${fileName}" }`)
        .join('\n\n');

    const root = unified()
        .use(remarkParse)
        .use(remarkDirective)
        .parse(input);

    let lastFileNameIndex = 0;

    function setNames(obj: any, name: string) {
        if (Array.isArray(obj)) {
            for (let item of obj) {
                setNames(item, name);
            }
        } else if (typeof obj === 'object' && obj !== null) {
            for (let key in obj) {
                setNames(obj[key], name);
            }
            if (typeof obj.type === 'string' && typeof obj.position === 'object' && obj.position !== null
                && typeof obj.position.start === 'object' && obj.position.start !== null
                && typeof obj.position.end === 'object' && obj.position.end !== null
            ) {
                obj.position.file = name;
            }
        }
    }

    for (let i = 0; i < root.children.length; i++) {
        let child = root.children[i]!;
        if (child.type === 'leafDirective' && child.name === 'file') {
            let name = child.attributes?.name;
            if (name) {
                setNames(root.children.slice(lastFileNameIndex, i + 1), name);
                lastFileNameIndex = i + 1;
            }
            continue;
        } else if (child.type === 'containerDirective' && child.name === 'book'
            && typeof child.attributes?.id === 'string' && typeof (book.meta as any)[child.attributes.id] === 'object'
        ) {
            let attrRoot = (book.meta as any)[child.attributes.id] as (Root | null);
            if (attrRoot == null) {
                attrRoot = { type: 'root', children: [] };
                (book.meta as any)[child.attributes.id] = attrRoot;
            }
            attrRoot.children.push(...child.children);
            continue;
        } else if (child.type === 'leafDirective' && child.name === 'book') {
            book.meta = { ...book.meta, ...child.attributes };
            continue;
        } else if (child.type === 'heading' && child.depth === 1) {
            book.chapters.push({
                title: toString(child),
                id: book.chapters.length + 1,
                root: { type: 'root', children: [] },
            });
        }
        if (book.chapters.length === 0) {
            book.chapters.push({
                title: '',
                id: book.chapters.length + 1,
                root: { type: 'root', children: [] },
            });
        }
        book.chapters.at(-1)!.root.children.push(child);
    }

    for (let chapter of book.chapters) {
        updateRootPositions(chapter.root);
    }

    for (let name in book.meta) {
        let val = (book.meta as any)[name];
        if (typeof val === 'object' && val !== null && val.type === 'root') {
            updateRootPositions(val);
        }
    }

    return book;
}


async function convertToEpub(book: Book, outputPath: string) {
    let files = fs.readdirSync('tools/templates/epub', { recursive: true, withFileTypes: true })
        .filter(file => file.isFile())
        .filter(file => !file.name.startsWith('_'));

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const output = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    const outputFinished = new Promise((resolve, reject) => {
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
    });

    try {
        archive.pipe(output);

        // EPUB requirement: first ZIP entry, uncompressed.
        archive.append('application/epub+zip', { name: 'mimetype', store: true });

        for (let file of files) {
            const filePath = path.join(file.parentPath, file.name);
            const relativePath = path.relative('tools/templates/epub', filePath);
            let fileTemplate = template(fs.readFileSync(filePath, 'utf-8'));
            let fileContent = fileTemplate({ ...book, version: { isoTime: 'TODO' } });
            archive.append(fileContent, { name: relativePath.replace(/\\/g, '/') });
        }

        let externalFiles: Set<string> = new Set();

        if (book.meta.cover) {
            externalFiles.add(book.meta.cover);
        }

        let chapterTemplate = template(fs.readFileSync('tools/templates/epub/OEBPS/_chapter.xhtml', 'utf-8'));

        for (let chapter of book.chapters) {
            const relativePath = `OEBPS/chapter${chapter.id}.xhtml`;
            let fileContent = chapterTemplate({ ...book, version: { isoTime: 'TODO' }, chapter: chapter, externalFiles, mdastToHtml });
            archive.append(fileContent, { name: relativePath.replace(/\\/g, '/') });
        }

        for (let externalFile of externalFiles.values()) {
            const filePath = path.join('tekst', externalFile);
            archive.append(fs.readFileSync(filePath), { name: `OEBPS/${externalFile.replace(/\\/g, '/')}` });
        }

        await Promise.all([
            archive.finalize(),
            outputFinished
        ]);
    } finally {
        archive.destroy();
        output.destroy();
    }
    return files;
}

async function convertToDocx(book: any, outputPath: string) {
    let externalFiles: Set<string> = new Set();

    let doctmlPath = path.join('tmp', outputPath + '.doctml');

    if (book.meta.cover) {
        externalFiles.add(book.meta.cover);
    }

    let doctmlTemplate = template(fs.readFileSync('tools/templates/doctml/book.doctml', 'utf-8'));
    let fileContent = doctmlTemplate({ ...book, version: { isoTime: 'TODO' }, externalFiles, mdastToDocTML });
    fs.mkdirSync(path.dirname(doctmlPath), { recursive: true });
    fs.writeFileSync(doctmlPath, fileContent);

    for (let externalFile of externalFiles.values()) {
        const filePath = path.join('tekst', externalFile);
        const destPath = path.join(path.dirname(doctmlPath), externalFile);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(filePath, destPath);
    }

    execFileSync('doctml', [doctmlPath, outputPath]);
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', outputPath, '--outdir', path.dirname(outputPath)]);
}

async function convertToPlainText(book: any, outputPath: string) {

    let txtTemplate = template(fs.readFileSync('tools/templates/txt/book.txt', 'utf-8'));
    let fileContent = txtTemplate({ ...book, mdastToPlainText });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, fileContent);
}

function showConvertStats(book: any) {
    let stats: BookStats | null = null;
    for (let chapter of book.chapters) {
        stats = mdastStats(chapter.root, stats);
    }
    console.log('Words:     ', stats?.words);
    console.log('Sentences: ', stats?.sentences);
    console.log('Paragraphs:', stats?.paragraphs);
    console.log('Chapters:  ', book.chapters.length);
    console.log('Headings:');
    for (let i = 0; i < (stats?.headings?.length ?? 0); i++) {
        console.log(`  level ${i + 1}:  ${stats?.headings?.[i] ?? 0}`);
    }
}

async function main() {
    let book = parseInput();
    fs.writeFileSync('dist/output.json', JSON.stringify(book, null, 2));
    await convertToEpub(book, 'dist/output.epub');
    await convertToDocx(book, 'dist/output.docx');
    await convertToPlainText(book, 'dist/output.txt');
    showConvertStats(book);
}


await main();

