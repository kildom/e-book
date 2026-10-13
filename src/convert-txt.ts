
import type * as mdast from 'mdast';
import { mdastError } from './utils';

const lineWidth = 80;

function addNbsp(value: string): string {
    return value.replace(/(?<=(?:\s|^)\p{L}{1,2})\s+/gui, '\xA0');
}

function wordWrap(text: string): string {
    text = addNbsp(text);
    let words = text.split(/[\r\n\t ]+/);
    let lines: string[] = [''];
    for (let word of words) {
        if (!word) continue;
        let len = lines.at(-1)!.length;
        if (len + 1 + word.length > lineWidth && len > 0) {
            lines.push('');
        }
        lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + word;
    }
    return lines.join('\n').replace(/\xA0/g, ' ');
}

function center(text: string): string {
    let lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        lines[i] = lines[i]!.padStart((lineWidth + lines[i]!.length) / 2);
    }
    return lines.join('\n');
}

function justify(text: string): string {
    let lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
        lines[i] = justifyLine(lines[i]!);
    }
    return lines.join('\n');
}

function justifyLine(line: string): string {
    let words = line.split(' ');
    if (words.length === 1) return line;
    let totalSpaces = lineWidth - words.reduce((sum, word) => sum + word.length, 0);
    let spacesBetweenWords = Math.floor(totalSpaces / (words.length - 1));
    let extraSpaces = totalSpaces % (words.length - 1);
    let justifiedLine = '';
    let extraSpacesStart = words.length - 1 - extraSpaces;
    for (let i = 0; i < words.length - 1; i++) {
        justifiedLine += words[i] + ' '.repeat(spacesBetweenWords + (i >= extraSpacesStart ? 1 : 0));
    }
    justifiedLine += words[words.length - 1];
    return justifiedLine;
}



export function mdastToPlainText(node: mdast.Root | mdast.RootContent): string {

    let result = '';

    switch (node.type) {
        case 'root':
            return node.children.map(child => mdastToPlainText(child)).join('');
        case 'paragraph': {
            let text = node.children.map(child => mdastToPlainText(child)).join('');
            text = justify(wordWrap(text));
            return `${text}\n\n`;
        }
        case 'text':
            return node.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        case 'thematicBreak':
            return '-'.repeat(lineWidth) + '\n\n';
        case 'strong':
        case 'emphasis':
            return node.children.map(child => mdastToPlainText(child)).join('');
        case 'heading': {
            let text = node.children.map(child => mdastToPlainText(child)).join('');
            text = wordWrap(text);
            let lineLength = node.depth == 1 ? lineWidth : text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
            const sep = '##=-"`'[node.depth - 1]?.repeat(lineLength);
            if (node.depth == 1) {
                result = `\n${sep}\n${center(text)}\n${sep}\n\n`;
            } else {
                result = `\n${text}\n${sep}\n\n`;
            }
            return result;
        }
        default:
            mdastError(node, `Unsupported node type: ${node.type}`);
    }
};
