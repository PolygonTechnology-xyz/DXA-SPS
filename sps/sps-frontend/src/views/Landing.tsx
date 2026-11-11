import { useNavigate } from 'react-router-dom'
import { FolderOpen, MessageSquare, Zap, Workflow, LogIn, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui'

const FEATURES = [
  {
    ic: FolderOpen,
    title: 'All projects in one place',
    text: 'Switch between projects from a single sidebar without losing context.',
  },
  {
    ic: MessageSquare,
    title: 'Chat-first workflow',
    text: 'Describe what you need in plain language. No menus to hunt through.',
  },
  {
    ic: Zap,
    title: 'Guided from the start',
    text: "Suggested prompts show you what's possible the moment you sign in.",
  },
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 20px' }}>
        {/* nav */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
              <Workflow size={17} strokeWidth={2} />
            </span>
            SPS
          </div>
          <Button icon={LogIn} onClick={() => navigate('/login')}>Log in</Button>
        </nav>

        {/* hero */}
        <section style={{ textAlign: 'center', padding: '72px 0 56px' }}>
          <span
            style={{
              display: 'inline-block',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Your projects, one conversation away
          </span>
          <h1
            style={{
              fontSize: 'clamp(34px, 6vw, 60px)',
              lineHeight: 1.08,
              letterSpacing: '-.03em',
              fontWeight: 600,
              margin: '18px auto 16px',
              maxWidth: 760,
            }}
          >
            Ask anything about your projects. Get answers instantly.
          </h1>
          <p
            style={{
              color: 'var(--muted)',
              fontSize: 18,
              maxWidth: 560,
              margin: '0 auto 30px',
            }}
          >
            SPS brings all your projects into one place and lets you work with them through a simple
            AI chat.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/login')} style={{ height: 46, padding: '0 22px', fontSize: 15 }}>
              Get started
            </Button>
            <Button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} style={{ height: 46, padding: '0 22px', fontSize: 15 }}>
              See what it does
            </Button>
          </div>
        </section>

        {/* features */}
        <section
          id="features"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            paddingBottom: 72,
          }}
        >
          {FEATURES.map((f) => (
            <div key={f.title} className="ui-card" style={{ padding: 22 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'var(--accent-soft)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--accent)',
                  marginBottom: 14,
                }}
              >
                <f.ic size={19} strokeWidth={1.8} />
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>{f.title}</h3>
              <p style={{ margin: 0, color: 'var(--muted)' }}>{f.text}</p>
            </div>
          ))}
        </section>
      </div>

      <footer
        style={{
          borderTop: '1px solid var(--line)',
          padding: '24px 0',
          color: 'var(--muted)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        © 2026 SPS
      </footer>
    </div>
  )
}
