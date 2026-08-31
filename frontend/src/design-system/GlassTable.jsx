import GlassCard from './GlassCard.jsx';

// Tabela de vidro. columns: [{ key, label, align?: 'right', render?: (row)=>node }].
export default function GlassTable({ columns = [], rows = [], title, right, className = '' }) {
  return (
    <GlassCard className={`ds-tbl-wrap ${className}`}>
      {(title || right) && (
        <div className="ds-tbl-hd">
          {title ? <h3>{title}</h3> : <span />}
          {right}
        </div>
      )}
      <table className="ds-tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'r' : ''}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  );
}
