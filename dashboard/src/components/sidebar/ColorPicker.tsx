import styles from './ColorPicker.module.css';

const COLORS = [
  '#6e7681', // gray (default)
  '#cf222e', // red
  '#e16f24', // orange
  '#bf8700', // yellow
  '#1a7f37', // green
  '#0969da', // blue
  '#8250df', // purple
  '#bf3989', // pink
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className={styles.picker}>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`${styles.swatch} ${value === color ? styles.active : ''}`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
          title={color}
        />
      ))}
    </div>
  );
}
