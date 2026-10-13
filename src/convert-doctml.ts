
import type * as mdast from 'mdast';
import { mdastError } from './utils';


export function mdastToDocTML(node: mdast.Root | mdast.RootContent, externalFiles: Set<string>): string {

    let useNbsp = false;

    // TODO: Is it already supported by DocTML?
    function convertText(value: string): string {
        if (useNbsp && value.match(/^\s/)) {
            value = '\u00A0' + value.slice(1).trimStart();
        }
        useNbsp = !!value.match(/(?<=(?:\s|^)\p{L}{1,2})$/gui);
        value = value.replace(/(?<=(?:\s|^)\p{L}{1,2})\s+/gui, '&nbsp;');
        return value;
    }

    function convert(node: mdast.Root | mdast.RootContent, externalFiles: Set<string>): string {
        switch (node.type) {
            case 'root':
                useNbsp = false;
                return node.children.map(child => convert(child, externalFiles)).join('');
            case 'paragraph':
                useNbsp = false;
                return `<p>${node.children.map(child => convert(child, externalFiles)).join('')}</p>\n`;
            case 'thematicBreak':
                // TODO: thematicBreak in DocTML
                return '<p>--------- TODO: thematicBreak</p>\n'
            case 'text':
                return convertText(node.value);
            case 'strong':
                return `<b>${node.children.map(child => convert(child, externalFiles)).join('')}</b>`;
            case 'emphasis':
                return `<i>${node.children.map(child => convert(child, externalFiles)).join('')}</i>`;
            case 'heading':
                useNbsp = false;
                return `\n<h${node.depth}>${node.children.map(child => convert(child, externalFiles)).join('')}</h${node.depth}>\n`;
            default:
                mdastError(node, `Unsupported node type: ${node.type}`);
        }
    }

    return convert(node, externalFiles);
};
