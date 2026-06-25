/**
 * Renders assistant chat content as Markdown (GFM). Element styling is done with
 * Tailwind child selectors on the wrapper so the component stays a thin shell and
 * inherits the bubble's text color. Links open in a browser tab rather than
 * navigating the renderer.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTabsStore } from '@/stores/tabs'

const MD_CLASS = [
  'text-sm leading-relaxed',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
  '[&_p]:my-2',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold',
  '[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-[15px] [&_h2]:font-semibold',
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-elevation-3 [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border-medium [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_hr]:my-3 [&_hr]:border-border-subtle',
  '[&_table]:my-2 [&_table]:w-full [&_table]:text-xs',
  '[&_th]:border [&_th]:border-border-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-border-subtle [&_td]:px-2 [&_td]:py-1',
].join(' ')

export function ChatMarkdown({ content }: { content: string }) {
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)

  return (
    <div className={MD_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) openOrSwitchToTab(href)
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
