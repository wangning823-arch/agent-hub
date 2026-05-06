/**
 * 代码美化 Prompt 模板
 * 根据不同的美化级别和风格构建专业的 beautify prompt
 */

export interface BeautifyOptions {
  level: 'light' | 'moderate' | 'aggressive'
  style?: string
  preserveFunctionality: boolean
}

const STYLE_INSTRUCTIONS: Record<string, string> = {
  modern: `Modern clean style:
- Use Inter or system font stack
- Neutral color palette with one accent color
- Subtle shadows (0 1px 3px rgba(0,0,0,0.1))
- Rounded corners (8-12px)
- Generous padding (16-24px)
- CSS Grid/Flexbox layouts
- Smooth transitions (0.2s ease)`,

  glassmorphism: `Glassmorphism style:
- Semi-transparent backgrounds (rgba(255,255,255,0.1))
- Backdrop blur effects (backdrop-filter: blur(10px))
- Subtle borders with transparency
- Soft glowing accents
- Layered depth with subtle shadows
- Smooth gradient backgrounds`,

  neumorphism: `Neumorphism style:
- Soft, extruded appearance
- Dual shadows (light and dark)
- Muted color palette matching background
- Rounded corners (16-24px)
- Subtle inner shadows for pressed states
- Pastel or monochromatic colors`,

  brutalist: `Brutalist style:
- Bold, high-contrast colors
- Thick borders (2-4px)
- Sharp corners or exaggerated rounds
- Monospace fonts
- Raw, unpolished aesthetic
- Strong typography hierarchy`,

  gradient: `Gradient-heavy style:
- Rich linear/radial gradients
- Vibrant color combinations
- Gradient text where appropriate
- Gradient borders using border-image
- Color transitions and overlays
- Dark backgrounds with bright accents`,

  minimal: `Minimal clean style:
- Maximum whitespace
- Thin, precise typography
- Subtle gray color palette
- No shadows or minimal shadows
- Crisp borders (1px)
- Lots of breathing room
- Simple, elegant transitions`
}

export function buildBeautifyPrompt(options: BeautifyOptions): string {
  const { level, style, preserveFunctionality } = options

  const levelInstructions: Record<string, string> = {
    light: `LIGHT BEAUTIFICATION (微调美化):
- Fix spacing issues: ensure consistent margins and padding
- Normalize font sizes and line heights
- Fix color inconsistencies
- Ensure proper alignment
- Fix minor layout issues
- Add basic responsive breakpoints if missing
- Keep the overall structure and design intact
- Only make subtle visual improvements`,

    moderate: `MODERATE BEAUTIFICATION (中等美化):
- All light level improvements
- Add smooth transitions and hover effects
- Add subtle shadows for depth
- Add border-radius for softer corners
- Improve color harmony with a cohesive palette
- Add proper spacing system (8px grid)
- Enhance typography hierarchy
- Add subtle animations for interactive elements
- Improve visual rhythm and consistency
- Add loading states and visual feedback`,

    aggressive: `AGGRESSIVE BEAUTIFICATION (大幅美化):
- All moderate level improvements
- Redesign layout for better visual hierarchy
- Add sophisticated animations and micro-interactions
- Create a cohesive design system (colors, spacing, typography)
- Add gradient backgrounds and overlays
- Implement glassmorphism or other advanced visual effects
- Add decorative elements (patterns, shapes, icons)
- Create visual depth through layered shadows
- Add page transition effects
- Implement advanced CSS features (grid, clamp, custom properties)
- Transform into a polished, production-ready UI`
  }

  const styleInstruction = style && STYLE_INSTRUCTIONS[style]
    ? `\n\nDESIGN STYLE - ${style.toUpperCase()}:\n${STYLE_INSTRUCTIONS[style]}`
    : ''

  const preservationNote = preserveFunctionality
    ? `\n\nCRITICAL CONSTRAINT: You MUST preserve ALL existing functionality, event handlers, state management, data bindings, API calls, and business logic. Only modify CSS/styling and visual layout. Do NOT change any JavaScript logic, function names, variable names, or component structure. The code must work exactly the same way after beautification.`
    : ''

  return `You are an expert frontend designer and CSS specialist. Your task is to beautify the provided code while maintaining its core functionality.

${levelInstructions[level] || levelInstructions.moderate}
${styleInstruction}
${preservationNote}

RULES:
1. Output ONLY the beautified code. No explanations, no markdown fences, no comments about changes.
2. The output must be valid, complete code that can be used directly.
3. Preserve ALL existing class names, data attributes, and selectors used for JavaScript hooks.
4. If it's HTML/CSS, maintain the same element structure unless adding wrapper divs for layout.
5. If it's a React/Vue component, preserve all props, state, and lifecycle methods.
6. Use CSS custom properties (variables) for consistent theming where possible.
7. Ensure the code is responsive and works on mobile devices.
8. Add smooth, professional animations that enhance UX without being distracting.
9. Maintain accessibility (proper contrast ratios, focus states, semantic HTML).
10. If the language is not CSS/HTML/JSX/TSX, beautify the code style (formatting, naming, organization) while keeping the same logic.

Provide the beautified code directly without any wrapping or explanation:`
}
