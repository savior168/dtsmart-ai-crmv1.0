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
      viewBox="0 0 24 24"
      fill="none"
    >
      <path fill="#34A853" d="M12 2a8 8 0 0 0-8 8c0 5.15 5.2 10.78 7.06 12.58a1.36 1.36 0 0 0 1.88 0C14.8 20.78 20 15.15 20 10a8 8 0 0 0-8-8Z" />
      <path fill="#4285F4" d="M12 2a8 8 0 0 0-6.93 4L12 10l4.98-6A7.96 7.96 0 0 0 12 2Z" />
      <path fill="#EA4335" d="M5.07 6A7.94 7.94 0 0 0 4 10c0 1.4.47 2.95 1.18 4.52L12 10 5.07 6Z" />
      <path fill="#FBBC04" d="M5.18 14.52A27.2 27.2 0 0 0 11.06 22.58a1.36 1.36 0 0 0 1.88 0l1.42-1.48L12 10 5.18 14.52Z" />
      <path fill="#34A853" d="M16.98 4 12 10l2.36 11.1C16.3 18.92 20 14.17 20 10a7.96 7.96 0 0 0-3.02-6Z" />
      <circle cx="12" cy="10" r="2.6" fill="white" />
    </svg>
  );
}
