export function PrivateNoteBody({ body }: { body: string }) {
  const sections = body.split(
    /^[ \t]*```[^\r\n]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*(?:\r?\n|$)/gm,
  );

  return sections.map((section, index) =>
    index % 2 === 1 ? (
      <pre key={index} className="ticket-note-code"><code>{section}</code></pre>
    ) : section ? (
      <p key={index}>{section}</p>
    ) : null,
  );
}
