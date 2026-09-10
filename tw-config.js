/* Shared Tailwind CDN config — load immediately after cdn.tailwindcss.com
   Palette: black + gold + sapphire blue. Cream paper tones, brass hairlines, blue CTAs. */
tailwind.config = {
    theme: {
        extend: {
            colors: {
                // "lacquer" = the dark surface scale — true black with a faint cool tint
                lacquer: {
                    50:  '#f4f5f8',
                    100: '#e6e8ee',
                    200: '#c9cdd8',
                    300: '#a3a9b8',
                    400: '#7c8395',
                    500: '#5c6274',
                    600: '#454a5a',
                    700: '#31353f',
                    800: '#1f2229',
                    850: '#171a1f',
                    900: '#111317',
                    950: '#0a0b0e',
                },
                // "oxblood" (legacy name) — the house blue: sapphire CTAs that pop on black
                oxblood: {
                    300: '#8fb3ff',
                    400: '#5b8cff',
                    500: '#2f6bff',
                    600: '#2455d6',
                    700: '#1b41a8',
                    800: '#142e78',
                    900: '#0d1d4d',
                },
                // Ivory / cream — paper tones
                ivory: {
                    100: '#f7f1e3',
                    200: '#f2e9dc',
                    300: '#e7dcc4',
                    400: '#d8c9a9',
                },
                // Brass / gold — wordmark, hairlines, engraved details
                brass: {
                    300: '#d9b96a',
                    400: '#c19a3f',
                    500: '#9d7c2f',
                    600: '#7a6024',
                },
            },
            fontFamily: {
                display: ['Prata', 'Georgia', 'serif'],
                sans: ['Jost', 'Futura', 'system-ui', 'sans-serif'],
            },
            letterSpacing: {
                luxe: '0.28em',
                plate: '0.14em',
            },
        }
    }
};
