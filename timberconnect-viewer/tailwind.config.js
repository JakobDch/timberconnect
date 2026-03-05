/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Forest Green - Primary
        'forest': {
          50: '#f0f9f4',
          100: '#d9f0e3',
          200: '#b5e2c9',
          300: '#85cea8',
          400: '#50b37f',
          500: '#2d9660',
          600: '#1e7a4d',
          700: '#196240',
          800: '#174e35',
          900: '#14402d',
          950: '#0a2318',
        },
        // Copper - Accent
        'copper': {
          50: '#fdf6f3',
          100: '#fbeae3',
          200: '#f7d5c7',
          300: '#f0b8a1',
          400: '#e79070',
          500: '#d96f4a',
          600: '#c55536',
          700: '#a4432b',
          800: '#863928',
          900: '#6e3225',
        },
        // Neutrals from Logo
        'timber': {
          dark: '#3F3F3F',
          gray: '#8C8C8C',
          light: '#E5E5E5',
          bg: '#FAFAFA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'slide-up': 'slideUp 0.5s ease-out forwards',
        'scale-in': 'scaleIn 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'soft-lg': '0 10px 40px -10px rgba(0, 0, 0, 0.1), 0 2px 10px -2px rgba(0, 0, 0, 0.04)',
        'forest': '0 10px 40px -10px rgba(45, 150, 96, 0.3)',
      },
    },
  },
  plugins: [],
}
