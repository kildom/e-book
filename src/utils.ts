
import type * as mdast from 'mdast';


export function mdastError(node: mdast.Node, message: string): never {
    let start = node.position?.start;
    let end = node.position?.end;
    let pos: string;
    if (start) {
        if (end) {
            pos = `${node.position!.file}:${start.line}:${start.column}-${end.line}:${end.column}`;
        } else {
            pos = `${node.position!.file}:${start.line}:${start.column}`;
        }
    } else {
        pos = node.position?.file ?? '<unknown file>';
    }
    console.error(`${pos}: ${message}`);
    process.exit(1);
}
