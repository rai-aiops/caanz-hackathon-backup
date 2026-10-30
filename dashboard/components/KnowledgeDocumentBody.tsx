import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function KnowledgeDocumentBody({ body }: { body: string }) {
  return (
    <div className="knowledge-document-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href, title }) => (
            <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>
          ),
          table: ({ children }) => (
            <div className="knowledge-document-table-scroll"><table>{children}</table></div>
          ),
        }}
      >
        {body.replaceAll("\\n", "\n")}
      </Markdown>
    </div>
  );
}
