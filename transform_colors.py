import os, re

files = {
    'landing': {
        'path': 'app/page.tsx',
        'colors': {
            'primary': '#1f44f9',
            'background-light': '#f5f6f8',
            'background-dark': '#000000',
            'accent-purple': '#8b5cf6',
        }
    },
    'demo': {
        'path': 'app/demo/page.tsx',
        'colors': {
            'primary': '#1f44f9',
            'background-light': '#f5f6f8',
            'background-dark': '#060812',
            'neon-green': '#10b981',
            'neon-purple': '#a855f7',
            'neon-blue': '#3b82f6',
        }
    },
    'library': {
        'path': 'app/library/page.tsx',
        'colors': {
            'primary': '#8c25f4',
            'background-light': '#f7f5f8',
            'background-dark': '#0a060e',
            'accent-blue': '#00f2ff',
            'success-green': '#00ff9d',
            'card-dark': '#191022',
        }
    }
}

for name, info in files.items():
    with open(info['path'], 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix class to className
    content = content.replace(' class="', ' className="')
    # Fix for to htmlFor
    content = content.replace(' for="', ' htmlFor="')

    for color_name, hex_val in info['colors'].items():
        # Replace color classes like text-primary with text-[#1f44f9]
        pattern = r'(-)?(bg|text|border|ring|shadow|from|via|to|divide|fill|stroke)-' + color_name + r'(?![a-zA-Z0-9-])'
        replacement = r'\g<1>\g<2>-[' + hex_val + ']'
        content = re.sub(pattern, replacement, content)

    with open(info['path'], 'w', encoding='utf-8') as f:
        f.write(content)

print("Transform complete!")
