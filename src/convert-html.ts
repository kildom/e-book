
import type * as mdast from 'mdast';
import { mdastError } from './utils';

export function mdastToHtml(node: mdast.Root | mdast.RootContent, externalFiles: Set<string>, xhtml: boolean): string {

    switch (node.type) {
        case 'root':
            return node.children.map(child => mdastToHtml(child, externalFiles, xhtml)).join('');
        case 'paragraph':
            return `<p>${node.children.map(child => mdastToHtml(child, externalFiles, xhtml)).join('')}</p>\n`;
        case 'text':
            return node.value;
        case 'thematicBreak':
            return xhtml ? '<hr />' : '<hr>';
        case 'strong':
            return `<strong>${node.children.map(child => mdastToHtml(child, externalFiles, xhtml)).join('')}</strong>`;
        case 'emphasis':
            return `<em>${node.children.map(child => mdastToHtml(child, externalFiles, xhtml)).join('')}</em>`;
        case 'heading':
            return `\n<h${node.depth}>${node.children.map(child => mdastToHtml(child, externalFiles, xhtml)).join('')}</h${node.depth}>\n`;
        default:
            mdastError(node, `Unsupported node type: ${node.type}`);
    }
};
