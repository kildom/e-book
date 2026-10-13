
import type * as mdast from 'mdast';
import { mdastError } from './utils';

export interface BookStats {
    words: number;
    sentences: number;
    paragraphs: number;
    headings: number[];
};

export function mdastStats(node: mdast.Root | mdast.RootContent, inputStats?: BookStats | null): BookStats {

    let stats: BookStats = inputStats ?? { words: 0, sentences: 0, paragraphs: 0, headings: [] };

    function process(node: mdast.Root | mdast.RootContent): void {

        let result = '';

        switch (node.type) {
            case 'root':
                node.children.forEach(process);
                break;
            case 'paragraph':
                node.children.forEach(process);
                stats.paragraphs++;
                break;
            case 'text':
                stats.words += node.value.split(/[\r\n\t ]+/).length;
                stats.sentences += node.value.split(/[.!?]+/).filter(x => x.trim()).length;
                break;
            case 'strong':
            case 'emphasis':
                break;
            case 'heading': {
                node.children.forEach(process);
                stats.headings[node.depth - 1] = (stats.headings[node.depth - 1] ?? 0) + 1;
                break;
            }
            default:
                mdastError(node, `Unsupported node type: ${node.type}`);
        }
    }

    process(node);

    return stats;
};
