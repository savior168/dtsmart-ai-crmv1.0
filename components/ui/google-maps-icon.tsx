type GoogleMapsIconProps = {
  size?: number;
  className?: string;
};

/** Google Maps four-colour pin for links that open an actual Maps location. */
export function GoogleMapsIcon({ size = 16, className }: GoogleMapsIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
    >
      <path fill="#1A73E8" d="M24 4a20 20 0 0 0-14.14 34.14L24 46l9.86-7.86A20 20 0 0 0 24 4Z" />
      <path fill="#EA4335" d="M24 4a20 20 0 0 1 14.14 5.86L24 24V4Z" />
      <path fill="#FBBC04" d="M38.14 9.86A20 20 0 0 1 42.3 28.4L24 24l14.14-14.14Z" />
      <path fill="#34A853" d="M42.3 28.4a20 20 0 0 1-8.44 9.74L24 46V24l18.3 4.4Z" />
      <circle cx="24" cy="24" r="7.2" fill="white" />
    </svg>
  );
}
