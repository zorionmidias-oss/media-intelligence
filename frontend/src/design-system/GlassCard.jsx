// Cartão de vidro (Liquid Glass). `hover` adiciona lift + sombra ao passar o mouse.
export default function GlassCard({ className = '', children, hover = false, ...rest }) {
  return (
    <div className={`glass ${hover ? 'ds-hover' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}
