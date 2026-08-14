export type EvalWriter = (line: string) => void;

export function defaultWrite(line: string): void {
  process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
}
