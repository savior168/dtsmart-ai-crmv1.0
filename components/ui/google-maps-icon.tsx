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
      viewBox="0 0 120 120"
      fill="none"
    >
      <path fill="#34A853" d="M60 6C33.5 6 12 27.5 12 54c0 22.8 14.4 39.8 28.8 57.5L55 114c2.8 3.5 7.2 3.5 10 0l14.2-2.5C93.6 93.8 108 76.8 108 54 108 27.5 86.5 6 60 6Z" />
      <path fill="#4285F4" d="M60 6C42.6 6 27.4 15.3 19.1 29.2L48.8 49 82.5 13.6A47.8 47.8 0 0 0 60 6Z" />
      <path fill="#EA4335" d="M19.1 29.2A47.8 47.8 0 0 0 12 54c0 7.3 1.5 14.2 4.2 20.5L48.8 49 19.1 29.2Z" />
      <path fill="#FBBC04" d="M16.2 74.5c4.8 11.2 13.1 21.8 24.6 35.9L61.2 83 48.8 49 16.2 74.5Z" />
      <path fill="#34A853" d="M82.5 13.6 48.8 49 61.2 83l18-21.5C91.6 46.3 99.7 32.8 82.5 13.6Z" />
      <circle cx="60" cy="54" r="16" fill="white" />
    </svg>
  );
}
