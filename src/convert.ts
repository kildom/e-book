import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
function findTemplateDir(): string {
    for (const dir of [path.join(SCRIPT_DIR, 'templates'), path.join(SCRIPT_DIR, '..', 'templates')]) {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            return dir;
        }
    }
    throw new Error(`Could not find templates directory in ${SCRIPT_DIR} or its parent directory.`);
}
const TEMPLATE_DIR = findTemplateDir();

declare module "unist" {
    interface Position {
        file: string;
    }
}
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

function parseInput(inputDir: string): Book {

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


    let input = [...fs.readdirSync(inputDir)]
        .filter(fileName => fileName.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b))
        .map(fileName => fs.readFileSync(path.join(inputDir, fileName), 'utf-8').replace(/\r\n/g, '\n') + `\n\n::file{ name="${fileName}" }`)
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


function writeDebugEpubFile(debugDir: string | undefined, entryPath: string, contents: string | Buffer) {
    if (!debugDir) {
        return;
    }

    const epubDebugDir = path.resolve(debugDir, 'epub');
    const filePath = path.resolve(epubDebugDir, ...entryPath.split('/'));
    if (!filePath.startsWith(`${epubDebugDir}${path.sep}`)) {
        throw new Error(`Invalid EPUB entry path: ${entryPath}`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

async function convertToEpub(book: Book, inputDir: string, outputPath: string, debugDir?: string) {
    const epubTemplateDir = path.join(TEMPLATE_DIR, 'epub');
    let files = fs.readdirSync(epubTemplateDir, { recursive: true, withFileTypes: true })
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
        const mimetype = 'application/epub+zip';
        writeDebugEpubFile(debugDir, 'mimetype', mimetype);
        archive.append(mimetype, { name: 'mimetype', store: true });

        for (let file of files) {
            const filePath = path.join(file.parentPath, file.name);
            const relativePath = path.relative(epubTemplateDir, filePath);
            let fileTemplate = template(fs.readFileSync(filePath, 'utf-8'));
            let fileContent = fileTemplate({ ...book, version: { isoTime: 'TODO' } });
            const entryPath = relativePath.replace(/\\/g, '/');
            writeDebugEpubFile(debugDir, entryPath, fileContent);
            archive.append(fileContent, { name: entryPath });
        }

        let externalFiles: Set<string> = new Set();

        if (book.meta.cover) {
            externalFiles.add(book.meta.cover);
        }

        let chapterTemplate = template(fs.readFileSync(path.join(epubTemplateDir, 'OEBPS/_chapter.xhtml'), 'utf-8'));

        for (let chapter of book.chapters) {
            const relativePath = `OEBPS/chapter${chapter.id}.xhtml`;
            let fileContent = chapterTemplate({ ...book, version: { isoTime: 'TODO' }, chapter: chapter, externalFiles, mdastToHtml });
            const entryPath = relativePath.replace(/\\/g, '/');
            writeDebugEpubFile(debugDir, entryPath, fileContent);
            archive.append(fileContent, { name: entryPath });
        }

        for (let externalFile of externalFiles.values()) {
            const filePath = path.join(inputDir, externalFile);
            const entryPath = `OEBPS/${externalFile.replace(/\\/g, '/')}`;
            const fileContent = fs.readFileSync(filePath);
            writeDebugEpubFile(debugDir, entryPath, fileContent);
            archive.append(fileContent, { name: entryPath });
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

async function convertToDocx(book: any, inputDir: string, outputPath: string, debugDir?: string) {
    let externalFiles: Set<string> = new Set();

    let doctmlPath = path.join('tmp', outputPath + '.doctml');

    if (book.meta.cover) {
        externalFiles.add(book.meta.cover);
    }

    let doctmlTemplate = template(fs.readFileSync(path.join(TEMPLATE_DIR, 'doctml/book.doctml'), 'utf-8'));
    let fileContent = doctmlTemplate({ ...book, version: { isoTime: 'TODO' }, externalFiles, mdastToDocTML });
    fs.mkdirSync(path.dirname(doctmlPath), { recursive: true });
    fs.writeFileSync(doctmlPath, fileContent);
    if (debugDir) {
        fs.writeFileSync(path.join(debugDir, `${path.basename(outputPath, '.docx')}.doctml`), fileContent);
    }

    for (let externalFile of externalFiles.values()) {
        const filePath = path.join(inputDir, externalFile);
        const destPath = path.join(path.dirname(doctmlPath), externalFile);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(filePath, destPath);
    }

    execFileSync('doctml', [doctmlPath, outputPath]);
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', outputPath, '--outdir', path.dirname(outputPath)]);
}

async function convertToPlainText(book: any, outputPath: string) {

    let txtTemplate = template(fs.readFileSync(path.join(TEMPLATE_DIR, 'txt/book.txt'), 'utf-8'));
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

async function main(inputDir: string, outputBase: string, debug: boolean) {
    const debugDir = debug ? `${outputBase}.debug` : undefined;
    if (debugDir) {
        fs.rmSync(debugDir, { recursive: true, force: true });
        fs.mkdirSync(debugDir, { recursive: true });
    }

    let book = parseInput(inputDir);
    fs.mkdirSync(path.dirname(outputBase), { recursive: true });
    if (debugDir) {
        fs.writeFileSync(path.join(debugDir, `${path.basename(outputBase)}.json`), JSON.stringify(book, null, 2));
    }
    await convertToEpub(book, inputDir, `${outputBase}.epub`, debugDir);
    await convertToDocx(book, inputDir, `${outputBase}.docx`, debugDir);
    await convertToPlainText(book, `${outputBase}.txt`);
    showConvertStats(book);
}

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const positionalArgs = args.filter(arg => arg !== '--debug');
const [inputDir, outputBase] = positionalArgs;
if (!inputDir || !outputBase || positionalArgs.length !== 2) {
    console.error('Usage: convert <input-directory> <output-name> [--debug]');
    process.exitCode = 1;
} else {
    await main(inputDir, outputBase, debug);
}
