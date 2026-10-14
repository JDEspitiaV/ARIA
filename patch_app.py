import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Add state
content = content.replace(
    'const [showOnboardingModal, setShowOnboardingModal] = useState(false);',
    'const [showOnboardingModal, setShowOnboardingModal] = useState(false);\n  const [isProfileLoading, setIsProfileLoading] = useState(true);'
)

# Add setIsProfileLoading(true) after setShowAuthModal(false)
content = content.replace(
    'setShowAuthModal(false);\n        // Load profile from Firestore',
    'setShowAuthModal(false);\n        setIsProfileLoading(true);\n        // Load profile from Firestore'
)

# Add setIsProfileLoading(false)
content = content.replace(
    'setShowOnboardingModal(false);\n        }',
    'setShowOnboardingModal(false);\n        }\n        setIsProfileLoading(false);'
)

content = content.replace(
    'setShowAuthModal(true);\n      }',
    'setShowAuthModal(true);\n        setIsProfileLoading(false);\n      }'
)

with open('src/App.tsx', 'w') as f:
    f.write(content)

