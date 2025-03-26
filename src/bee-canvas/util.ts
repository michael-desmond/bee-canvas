export function tagSelectedMarkdownByOffset(
  markdown: string,
  offset: number,
  length: number,
  tag = "tag",
): string {
  if (offset < 0 || length <= 0 || offset + length > markdown.length) {
    return markdown;
  }

  const before = markdown.slice(0, offset);
  const selectedText = markdown.slice(offset, offset + length);
  const after = markdown.slice(offset + length);

  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;

  return `${before}${startTag}${selectedText}${endTag}${after}`;
}
