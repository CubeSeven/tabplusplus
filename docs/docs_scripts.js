document.addEventListener('DOMContentLoaded', () => {
    // --- Typing Animation (Interactive Palette) ---
    const typingText = document.querySelector('.typing-text');
    const demoResults = document.getElementById('demo-results');
    
    const phrases = [
        { text: "Tidy workspace", results: ['🪄 Magic Organize', '🧹 De-duplicate', '📦 Auto-Group by Domain'] },
        { text: "!gh tabsplusplus", results: ['🐙 Search GitHub', '⭐ Star Repository', '🍴 Fork Repo'] },
        { text: "> Hibernate All", results: ['💤 Sleeping 45 tabs...', '🔋 CPU usage -80%', '🧊 Memory flushed'] },
        { text: "!pinned bookmarks", results: ['📌 "!Gmail" opens pinned', '🔖 Folder → tab group', '🗂 Instant workspace'] },
        { text: "youtube.com", results: ['📺 Watch Later', '🔍 Search History', '🔖 Bookmarks: Music'] }
    ];

    let phraseIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typeSpeed = 100;

    function type() {
        const currentPhrase = phrases[phraseIndex].text;
        
        if (isDeleting) {
            typingText.textContent = currentPhrase.substring(0, charIndex - 1);
            charIndex--;
            typeSpeed = 50;
        } else {
            typingText.textContent = currentPhrase.substring(0, charIndex + 1);
            charIndex++;
            typeSpeed = 100;
        }

        if (!isDeleting && charIndex === currentPhrase.length) {
            isDeleting = true;
            typeSpeed = 2000; // Pause at end
            showResults(phrases[phraseIndex].results);
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            phraseIndex = (phraseIndex + 1) % phrases.length;
            typeSpeed = 500;
            clearResults();
        }

        setTimeout(type, typeSpeed);
    }

    function showResults(results) {
        demoResults.innerHTML = '';
        results.forEach((res, i) => {
            const div = document.createElement('div');
            div.className = 'res-item';
            div.style.animation = `fadeIn 0.3s ease ${i * 0.1}s forwards`;
            div.style.opacity = '0';
            div.textContent = res;
            demoResults.appendChild(div);
        });
    }

    function clearResults() {
        demoResults.innerHTML = '';
    }

    // Landing page only: the interactive typing demo element doesn't exist on
    // the docs page. Guard so docs.html doesn't throw and kill the rest of
    // the DOMContentLoaded handler (scroll reveal, navbar blur, mobile drawer).
    if (typingText && demoResults) {
        type();
    }

    // --- Scroll Reveal ---
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, observerOptions);

    document.querySelectorAll('.feature-card, .section-title, .hero-content').forEach(el => {
        el.classList.add('reveal-on-scroll');
        observer.observe(el);
    });

    // --- Navbar Blur on Scroll (landing page only) ---
    window.addEventListener('scroll', () => {
        const nav = document.querySelector('.navbar');
        if (!nav) return;
        if (window.scrollY > 50) {
            nav.style.background = 'rgba(5, 5, 5, 0.8)';
            nav.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
        } else {
            nav.style.background = 'rgba(5, 5, 5, 0.6)';
            nav.style.boxShadow = 'none';
        }
    });

    // --- Mobile Docs Drawer ---
    const menuToggle = document.getElementById('docs-menu-toggle');
    const sidebar = document.getElementById('docs-sidebar');
    const overlay = document.getElementById('docs-overlay');

    function setDrawer(open) {
        if (!sidebar || !overlay || !menuToggle) return;
        sidebar.classList.toggle('open', open);
        overlay.classList.toggle('visible', open);
        overlay.hidden = !open;
        menuToggle.setAttribute('aria-expanded', String(open));
    }

    if (menuToggle && sidebar && overlay) {
        menuToggle.addEventListener('click', () => {
            setDrawer(!sidebar.classList.contains('open'));
        });
        overlay.addEventListener('click', () => setDrawer(false));
        // Close drawer after navigating to a section (mobile link tap)
        sidebar.querySelectorAll('a.sidebar-link').forEach(link => {
            link.addEventListener('click', () => setDrawer(false));
        });
        // Escape closes the drawer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') setDrawer(false);
        });
    }
});

// Add extra styles for reveal
const style = document.createElement('style');
style.textContent = `
    .reveal-on-scroll {
        opacity: 0;
        transform: translateY(30px);
        transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .reveal-on-scroll.revealed {
        opacity: 1;
        transform: translateY(0);
    }
`;
document.head.appendChild(style);
