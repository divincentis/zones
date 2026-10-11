interface DisclaimerModalProps {
  onAcknowledge: () => void;
}

export function DisclaimerModal({ onAcknowledge }: DisclaimerModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-primary)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        }}
      >
        <h2 id="disclaimer-title" style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--zone-1)' }}>
          FOR VISUALIZATION ONLY — NOT A DESIGN TOOL
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          This tool renders an approximate graphical representation of wind zone geometry based on
          the zone figures in FM Global Property Loss Prevention Data Sheet 1-28, Wind Design. It
          does not calculate wind pressures, does not account for every building
          configuration, exception, or local amendment, and its output has not been independently
          verified.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Do not rely on it for design, fastener or attachment patterns, product selection,
          submittals, permitting, or construction. All zone layouts must be independently
          determined and verified by a licensed design professional using the governing code and
          the actual project documents.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
          Provided "as is," without warranty of any kind, express or implied. Page creator assumes
          no liability for any use of or reliance on this tool.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onAcknowledge}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
