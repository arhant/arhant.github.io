/* ========================================
   MAIN JAVASCRIPT
   Navigation, animations, interactions
   ======================================== */

(function () {
    'use strict';

    // ---- Loading Screen ----
    window.addEventListener('load', function () {
        var loader = document.getElementById('loader');
        if (loader) {
            setTimeout(function () {
                loader.classList.add('hidden');
            }, 800);
        }
    });

    // Safety fallback
    setTimeout(function () {
        var loader = document.getElementById('loader');
        if (loader) loader.classList.add('hidden');
    }, 3000);

    // ---- Typewriter Effect ----
    var typewriterEl = document.getElementById('typewriter');
    if (typewriterEl) {
        var titles = [
            'Tech Lead & Senior Software Engineer',
            'Distributed Systems & Cloud Architect',
            'CI/CD & DevOps Engineer',
            'Python & Serverless Developer',
            'Building Systems at 99.95%+ Uptime'
        ];
        var titleIndex = 0;
        var charIndex = 0;
        var isDeleting = false;
        var typeSpeed = 60;

        function typewrite() {
            var current = titles[titleIndex];

            if (isDeleting) {
                typewriterEl.textContent = current.substring(0, charIndex - 1);
                charIndex--;
                typeSpeed = 30;
            } else {
                typewriterEl.textContent = current.substring(0, charIndex + 1);
                charIndex++;
                typeSpeed = 60;
            }

            if (!isDeleting && charIndex === current.length) {
                typeSpeed = 2000; // Pause at end
                isDeleting = true;
            } else if (isDeleting && charIndex === 0) {
                isDeleting = false;
                titleIndex = (titleIndex + 1) % titles.length;
                typeSpeed = 400; // Pause before next word
            }

            setTimeout(typewrite, typeSpeed);
        }

        setTimeout(typewrite, 1000);
    }

    // ---- Navigation ----
    var nav = document.getElementById('nav');
    var navToggle = document.querySelector('.nav-toggle');
    var mobileMenu = document.querySelector('.mobile-menu');
    var navLinks = document.querySelectorAll('.nav-link');
    var mobileLinks = document.querySelectorAll('.mobile-link');

    // Scroll detection for nav background
    var lastScroll = 0;
    window.addEventListener('scroll', function () {
        var scrollY = window.scrollY || window.pageYOffset;
        if (nav) {
            if (scrollY > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }
        lastScroll = scrollY;
    });

    // Hamburger toggle
    if (navToggle && mobileMenu) {
        navToggle.addEventListener('click', function () {
            navToggle.classList.toggle('active');
            mobileMenu.classList.toggle('open');
        });
    }

    // Close mobile menu on link click
    mobileLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            if (navToggle) navToggle.classList.remove('active');
            if (mobileMenu) mobileMenu.classList.remove('open');
        });
    });

    // Active nav link on scroll
    var sections = document.querySelectorAll('.section, .hero');

    function updateActiveNav() {
        var scrollY = window.scrollY || window.pageYOffset;
        var offset = 200;

        sections.forEach(function (section) {
            var top = section.offsetTop - offset;
            var height = section.offsetHeight;
            var id = section.getAttribute('id');

            if (scrollY >= top && scrollY < top + height) {
                navLinks.forEach(function (link) {
                    link.classList.remove('active');
                    if (link.getAttribute('data-section') === id) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }

    window.addEventListener('scroll', updateActiveNav);

    // Smooth scroll for all anchor links
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            var target = document.querySelector(this.getAttribute('href'));
            if (target) {
                var navHeight = nav ? nav.offsetHeight : 70;
                var targetPos = target.getBoundingClientRect().top + window.scrollY - navHeight;
                window.scrollTo({ top: targetPos, behavior: 'smooth' });
            }
        });
    });

    // ---- Counter Animation ----
    var counters = document.querySelectorAll('.stat-number');
    var counterObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                var el = entry.target;
                var target = parseInt(el.getAttribute('data-target'), 10);
                var duration = 2000;
                var start = 0;
                var startTime = null;

                function animateCounter(timestamp) {
                    if (!startTime) startTime = timestamp;
                    var progress = Math.min((timestamp - startTime) / duration, 1);
                    // Ease out cubic
                    var eased = 1 - Math.pow(1 - progress, 3);
                    el.textContent = Math.floor(eased * target);
                    if (progress < 1) {
                        requestAnimationFrame(animateCounter);
                    } else {
                        el.textContent = target;
                    }
                }

                requestAnimationFrame(animateCounter);
                counterObserver.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(function (counter) {
        counterObserver.observe(counter);
    });

    // ---- Scroll Reveal Animations ----
    var revealElements = document.querySelectorAll(
        '.about-text, .about-highlights, .highlight-card, .exp-card, ' +
        '.skill-card, .project-card, .edu-card, .contact-content'
    );

    var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal', 'visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    revealElements.forEach(function (el, index) {
        el.classList.add('reveal');
        el.style.transitionDelay = Math.min(index * 0.08, 0.4) + 's';
        revealObserver.observe(el);
    });

    // ---- Tilt Effect on Skill Cards ----
    if (window.innerWidth > 768) {
        document.querySelectorAll('[data-tilt]').forEach(function (card) {
            card.addEventListener('mousemove', function (e) {
                var rect = card.getBoundingClientRect();
                var x = e.clientX - rect.left;
                var y = e.clientY - rect.top;
                var centerX = rect.width / 2;
                var centerY = rect.height / 2;
                var rotateX = (y - centerY) / centerY * -5;
                var rotateY = (x - centerX) / centerX * 5;

                card.style.transform =
                    'translateY(-6px) perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)';
            });

            card.addEventListener('mouseleave', function () {
                card.style.transform = '';
            });
        });
    }

    // ---- Magnetic Effect on Buttons ----
    if (window.innerWidth > 768) {
        document.querySelectorAll('.btn').forEach(function (btn) {
            btn.addEventListener('mousemove', function (e) {
                var rect = btn.getBoundingClientRect();
                var x = e.clientX - rect.left - rect.width / 2;
                var y = e.clientY - rect.top - rect.height / 2;
                btn.style.transform = 'translate(' + x * 0.15 + 'px, ' + (y * 0.15 - 2) + 'px)';
            });

            btn.addEventListener('mouseleave', function () {
                btn.style.transform = '';
            });
        });
    }

    // ---- Project Cards Glow Effect ----
    document.querySelectorAll('.project-card, .highlight-card').forEach(function (card) {
        card.addEventListener('mousemove', function (e) {
            var rect = card.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            card.style.setProperty('--glow-x', x + 'px');
            card.style.setProperty('--glow-y', y + 'px');
        });
    });

    // ---- Scroll Progress Bar ----
    var progressBar = document.getElementById('scroll-progress');
    if (progressBar) {
        window.addEventListener('scroll', function () {
            var scrollY = window.scrollY || window.pageYOffset;
            var docHeight = document.documentElement.scrollHeight - window.innerHeight;
            var pct = docHeight > 0 ? (scrollY / docHeight) * 100 : 0;
            progressBar.style.width = pct + '%';
        });
    }

    // ---- Back to Top Button ----
    var backToTop = document.getElementById('back-to-top');
    if (backToTop) {
        window.addEventListener('scroll', function () {
            var scrollY = window.scrollY || window.pageYOffset;
            if (scrollY > window.innerHeight * 0.8) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        });
        backToTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ---- Custom Cursor Glow (desktop only) ----
    var cursorGlow = document.getElementById('cursor-glow');
    if (cursorGlow && window.innerWidth > 768) {
        var cx = 0, cy = 0, tx = 0, ty = 0;

        document.addEventListener('mousemove', function (e) {
            tx = e.clientX;
            ty = e.clientY;
            if (!cursorGlow.classList.contains('active')) {
                cursorGlow.classList.add('active');
            }
        });

        function animateCursor() {
            cx += (tx - cx) * 0.15;
            cy += (ty - cy) * 0.15;
            cursorGlow.style.left = cx + 'px';
            cursorGlow.style.top = cy + 'px';
            requestAnimationFrame(animateCursor);
        }
        animateCursor();

        // Grow on hover over interactive elements
        var hoverTargets = 'a, button, .btn, .skill-card, .project-card, .contact-card, .highlight-card';
        document.addEventListener('mouseover', function (e) {
            if (e.target.closest(hoverTargets)) {
                cursorGlow.classList.add('hovering');
            }
        });
        document.addEventListener('mouseout', function (e) {
            if (e.target.closest(hoverTargets)) {
                cursorGlow.classList.remove('hovering');
            }
        });
    }

    // ---- Click Sparkle Particles ----
    var sparkleColors = ['#7b73ff', '#38d9ff', '#ff7bab', '#9966ff', '#00cccc'];
    document.addEventListener('click', function (e) {
        for (var i = 0; i < 7; i++) {
            var spark = document.createElement('div');
            spark.className = 'sparkle';
            var angle = (Math.PI * 2 / 7) * i + Math.random() * 0.5;
            var dist = 30 + Math.random() * 40;
            spark.style.left = e.clientX + 'px';
            spark.style.top = e.clientY + 'px';
            spark.style.background = sparkleColors[Math.floor(Math.random() * sparkleColors.length)];
            spark.style.setProperty('--sx', Math.cos(angle) * dist + 'px');
            spark.style.setProperty('--sy', Math.sin(angle) * dist + 'px');
            document.body.appendChild(spark);
            setTimeout(function () { spark.remove(); }, 650);
        }
    });

    // ---- Copy Email with Toast ----
    var emailCard = document.getElementById('email-card');
    if (emailCard) {
        emailCard.addEventListener('click', function (e) {
            e.preventDefault();
            var email = emailCard.getAttribute('data-email');
            if (navigator.clipboard) {
                navigator.clipboard.writeText(email);
            }
            var toast = emailCard.querySelector('.copy-toast');
            if (toast) {
                toast.classList.add('show');
                setTimeout(function () { toast.classList.remove('show'); }, 2000);
            }
        });
    }
})();
