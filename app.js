/**
 * MSP Chauffeur Service — Premium Booking Application
 * Shared engine: pricing, distance, quote widget, autocomplete, utilities.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    // Pricing rates — first 7 miles included in base fare, then per-mile.
    // TC Black Car fleet: adjust rates here in one place.
    rates: {
        sedan:    { base: 60.00,  min: 65.00,  perMile: 3.30, hourly: 75  },  // Lincoln Continental — 1-3 passengers, 4 bags
        suv:      { base: 75.00,  min: 80.00,  perMile: 3.60, hourly: 90  },  // GMC Yukon Denali — 1-6 passengers, 6 bags
        escalade: { base: 90.00,  min: 95.00,  perMile: 3.80, hourly: 110 },  // Cadillac Escalade — 1-6 passengers, 6 bags
        van:      { base: 110.00, min: 120.00, perMile: 3.90, hourly: 130 }   // Mercedes Sprinter — 1-10 passengers, 10 bags
        // Stretch limousine: quote by phone only.
    },
    // Hourly / as-directed service: flat hourly rate per vehicle, billed in whole hours.
    hourly: { minimumHours: 3, maximumHours: 12 },
    fees: {
        airport: 15.00,        // MSP pickup/dropoff fee
        nightSurcharge: 20.00, // 7 PM – 6 AM
        meetAndGreet: 15.00,   // chauffeur meets you inside baggage claim
        childSeat: 25.00,      // per installed child safety seat (max 4)
        stop: 15.00,           // per extra stop en route (max 3); mileage is routed through the stops
        maxStops: 3
    },
    vehicleNames: {
        sedan: 'Sedan',
        suv: 'SUV (GMC Yukon)',
        escalade: 'Premium SUV (Cadillac Escalade)',
        van: 'Sprinter Van'
    },
    // Business info
    phone: '+16126665004',
    phoneDisplay: '(612) 666-5004',
    email: 'tcblackcar@gmail.com',
    bookingPage: 'book-a-ride.html'
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const state = {
    pickup: '',
    dropoff: '',
    pickupValid: false,
    dropoffValid: false,
    date: '',
    time: '',
    vehicle: 'suv',
    distance: 0,
    duration: 0,
    price: 0,
    quoteCalculated: false
};

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const elements = {
    header: document.getElementById('header'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    mobileMenu: document.getElementById('mobile-menu'),
    quoteForm: document.getElementById('quote-form'),
    pickupInput: document.getElementById('pickup'),
    dropoffInput: document.getElementById('dropoff'),
    dateInput: document.getElementById('date'),
    timeInput: document.getElementById('time'),
    priceDisplay: document.getElementById('price-display'),
    priceValue: document.getElementById('price-value'),
    distanceValue: document.getElementById('distance-value'),
    submitBtn: document.getElementById('submit-btn'),
    submitText: document.getElementById('submit-text'),
    faqContainer: document.getElementById('faq-container')
};

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initDateTimeDefaults();
    initMobileMenu();
    initHeaderScroll();
    initQuoteForm();
    initFAQ();
    initSmoothScroll();
    initRevealAnimations();
});

// =============================================================================
// DATE/TIME DEFAULTS
// =============================================================================

function initDateTimeDefaults() {
    if (!elements.dateInput || !elements.timeInput) return;

    const now = new Date();

    // Minimum booking is 2 hours in advance
    const minBookingTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // If after 10 PM, default to tomorrow morning
    if (now.getHours() >= 22) {
        minBookingTime.setDate(minBookingTime.getDate() + 1);
        minBookingTime.setHours(9, 0, 0, 0);
    } else {
        // Round to next 15 minutes
        minBookingTime.setMinutes(Math.ceil(minBookingTime.getMinutes() / 15) * 15);
    }

    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${minBookingTime.getFullYear()}-${pad(minBookingTime.getMonth() + 1)}-${pad(minBookingTime.getDate())}`;
    elements.dateInput.value = dateStr;
    elements.dateInput.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const timeStr = `${pad(minBookingTime.getHours())}:${pad(minBookingTime.getMinutes())}`;
    elements.timeInput.value = timeStr;

    state.date = dateStr;
    state.time = timeStr;

    // Make clicking anywhere on the input open the picker
    elements.dateInput.addEventListener('click', function () {
        if (this.showPicker) this.showPicker();
    });
    elements.timeInput.addEventListener('click', function () {
        if (this.showPicker) this.showPicker();
    });
}

// =============================================================================
// MOBILE MENU
// =============================================================================

function initMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    if (!mobileMenuBtn || !mobileMenu) return;

    mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileMenu.classList.toggle('hidden');
        const isOpen = !mobileMenu.classList.contains('hidden');
        mobileMenuBtn.setAttribute('aria-expanded', isOpen);
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
        });
    });

    document.addEventListener('click', (e) => {
        if (!mobileMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
            mobileMenu.classList.add('hidden');
        }
    });
}

// =============================================================================
// HEADER SCROLL EFFECT
// =============================================================================

function initHeaderScroll() {
    if (!elements.header) return;

    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 50) {
            elements.header.classList.add('header-scrolled');
        } else {
            elements.header.classList.remove('header-scrolled');
        }
    }, { passive: true });
}

// =============================================================================
// QUOTE FORM (home page instant-quote widget)
// =============================================================================

function initQuoteForm() {
    if (!elements.quoteForm) return;

    document.querySelectorAll('input[name="vehicle"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.vehicle = e.target.value;
            if (state.quoteCalculated) recalculatePrice();
        });
    });

    if (elements.pickupInput) {
        elements.pickupInput.addEventListener('input', debounce(() => {
            state.pickup = elements.pickupInput.value;
        }, 300));
    }

    if (elements.dropoffInput) {
        elements.dropoffInput.addEventListener('input', debounce(() => {
            state.dropoff = elements.dropoffInput.value;
        }, 300));
    }

    if (elements.dateInput) {
        elements.dateInput.addEventListener('change', () => {
            state.date = elements.dateInput.value;
            if (state.quoteCalculated) recalculatePrice();
        });
    }

    if (elements.timeInput) {
        elements.timeInput.addEventListener('change', () => {
            state.time = elements.timeInput.value;
            if (state.quoteCalculated) recalculatePrice();
        });
    }

    elements.quoteForm.addEventListener('submit', handleQuoteSubmit);

    initAutocomplete();
}

async function handleQuoteSubmit(e) {
    e.preventDefault();

    if (!validateForm()) return;

    if (!state.quoteCalculated) {
        await calculateQuote();
    } else {
        redirectToBooking();
    }
}

function validateForm() {
    let valid = true;

    if (!elements.pickupInput.value.trim()) {
        showInputError(elements.pickupInput, 'Please enter a pickup location');
        valid = false;
    } else if (!state.pickupValid) {
        showInputError(elements.pickupInput, 'Please select an address from the dropdown');
        valid = false;
    }

    if (!elements.dropoffInput.value.trim()) {
        showInputError(elements.dropoffInput, 'Please enter a destination');
        valid = false;
    } else if (!state.dropoffValid) {
        showInputError(elements.dropoffInput, 'Please select an address from the dropdown');
        valid = false;
    }

    if (!elements.dateInput.value) {
        showInputError(elements.dateInput, 'Please select a date');
        valid = false;
    }

    if (!elements.timeInput.value) {
        showInputError(elements.timeInput, 'Please select a time');
        valid = false;
    }

    // 2-hour minimum booking window
    if (elements.dateInput.value && elements.timeInput.value) {
        const selectedDateTime = new Date(elements.dateInput.value + 'T' + elements.timeInput.value);
        const minBookingTime = new Date(Date.now() + 2 * 60 * 60 * 1000);

        if (selectedDateTime < minBookingTime) {
            showInputError(elements.timeInput, 'Bookings must be at least 2 hours in advance');
            valid = false;
        }
    }

    return valid;
}

function showInputError(input, message) {
    input.classList.add('input-error');

    const existingError = input.parentNode.querySelector('.error-message');
    if (existingError) existingError.remove();

    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.innerHTML = `
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
        ${message}
    `;
    input.parentNode.appendChild(errorEl);

    input.addEventListener('input', () => {
        input.classList.remove('input-error');
        const error = input.parentNode.querySelector('.error-message');
        if (error) error.remove();
    }, { once: true });
}

async function calculateQuote() {
    setLoadingState(true);

    try {
        const result = await getDistance(
            elements.pickupInput.value,
            elements.dropoffInput.value
        );

        if (result.distance > 0) {
            state.distance = result.distance;
            state.duration = result.duration;
            state.price = calculatePrice(result.distance, state.vehicle, state.time, elements.pickupInput.value);
            state.quoteCalculated = true;

            showPriceDisplay();
            elements.submitText.textContent = 'Reserve This Car';

            // Persist so any navigation to book-a-ride.html prefills the form.
            saveQuoteState();
        } else {
            showToast('Could not calculate route. Please check your addresses.', 'error');
        }
    } catch (error) {
        console.error('Quote calculation error:', error);

        // Fallback estimate
        const estimatedDistance = 15;
        state.distance = estimatedDistance;
        state.duration = Math.round(estimatedDistance * 1.5);
        state.price = calculatePrice(estimatedDistance, state.vehicle, state.time, elements.pickupInput.value);
        state.quoteCalculated = true;

        showPriceDisplay();
        elements.submitText.textContent = 'Reserve This Car';
        saveQuoteState();
    }

    setLoadingState(false);
}

// Persist the current quote into sessionStorage. book-a-ride.html reads
// 'tcb_booking' on load, prefills the form and jumps to step 2.
function saveQuoteState() {
    if (!state.quoteCalculated) return;
    try {
        const data = {
            pickup: elements.pickupInput?.value || '',
            dropoff: elements.dropoffInput?.value || '',
            pickupValid: !!state.pickupValid,
            dropoffValid: !!state.dropoffValid,
            date: state.date,
            time: state.time,
            vehicle: state.vehicle,
            distance: state.distance,
            duration: state.duration,
            price: state.price,
            startStep: 2
        };
        sessionStorage.setItem('tcb_booking', JSON.stringify(data));
    } catch (e) {
        // Non-fatal — visitor just won't see prefill
    }
}

function recalculatePrice() {
    if (state.distance > 0) {
        state.price = calculatePrice(state.distance, state.vehicle, state.time, elements.pickupInput.value);
        updatePriceDisplay();
        saveQuoteState();
    }
}

async function recalculateWithNewAddresses() {
    if (elements.priceValue) {
        elements.priceValue.innerHTML = '<span class="loading-dots">...</span>';
    }

    try {
        const result = await getDistance(
            elements.pickupInput.value,
            elements.dropoffInput.value
        );

        if (result.distance > 0) {
            state.distance = result.distance;
            state.duration = result.duration;
            state.price = calculatePrice(result.distance, state.vehicle, state.time, elements.pickupInput.value);

            if (elements.priceValue) elements.priceValue.textContent = state.price;
            if (elements.distanceValue) elements.distanceValue.textContent = state.distance;

            if (elements.priceDisplay) {
                elements.priceDisplay.classList.add('price-pulse');
                setTimeout(() => elements.priceDisplay.classList.remove('price-pulse'), 500);
            }

            saveQuoteState();
        }
    } catch (error) {
        console.error('Recalculation error:', error);
        if (elements.priceValue) elements.priceValue.textContent = state.price;
    }
}

function calculatePrice(distanceMiles, vehicleType, pickupTime, pickupAddress) {
    const rates = CONFIG.rates[vehicleType];
    if (!rates) return 0;

    let fare;

    // Base fare covers the first 7 miles
    if (distanceMiles <= 7) {
        fare = rates.base;
    } else {
        fare = rates.base + (rates.perMile * (distanceMiles - 7));
    }

    // Apply minimum fare
    fare = Math.max(fare, rates.min);

    // Night surcharge (7 PM – 6 AM)
    if (pickupTime) {
        const hour = parseInt(pickupTime.split(':')[0], 10);
        if (hour >= 19 || hour < 6) {
            fare += CONFIG.fees.nightSurcharge;
        }
    }

    // Airport fee
    if (isAirportAddress(pickupAddress)) {
        fare += CONFIG.fees.airport;
    }

    return Math.ceil(fare);
}

// Hourly / as-directed pricing: whole hours at the vehicle's hourly rate.
function calculateHourlyPrice(vehicleType, hours) {
    const rates = CONFIG.rates[vehicleType];
    if (!rates || !rates.hourly) return 0;
    const h = Math.min(Math.max(parseInt(hours, 10) || 0, CONFIG.hourly.minimumHours), CONFIG.hourly.maximumHours);
    return Math.ceil(rates.hourly * h);
}

function isAirportAddress(address) {
    if (!address) return false;
    const lower = address.toLowerCase();
    return lower.includes('airport') ||
           lower.includes('msp') ||
           lower.includes('terminal');
}

async function getDistance(origin, destination, waypoints = []) {
    return new Promise((resolve) => {
        if (typeof google === 'undefined' || !google.maps) {
            const dist = estimateDistance(origin, destination);
            resolve({ distance: dist, duration: Math.round(dist * 1.5) });
            return;
        }

        const service = new google.maps.DirectionsService();

        const stops = (waypoints || []).filter(Boolean).map(location => ({ location, stopover: true }));

        service.route({
            origin: origin,
            destination: destination,
            waypoints: stops,
            travelMode: google.maps.TravelMode.DRIVING
        }, (response, status) => {
            if (status === 'OK' && response.routes[0]) {
                // Sum every leg so extra stops are billed on the real routed mileage.
                const legs = response.routes[0].legs;
                const meters = legs.reduce((sum, leg) => sum + leg.distance.value, 0);
                const seconds = legs.reduce((sum, leg) => sum + leg.duration.value, 0);
                const distanceMiles = meters * 0.000621371;
                resolve({
                    distance: parseFloat(distanceMiles.toFixed(1)),
                    duration: Math.round(seconds / 60)
                });
            } else {
                const dist = estimateDistance(origin, destination);
                resolve({ distance: dist, duration: Math.round(dist * 1.5) });
            }
        });
    });
}

function estimateDistance(origin, destination) {
    const originLower = origin.toLowerCase();
    const destLower = destination.toLowerCase();

    if ((originLower.includes('airport') || originLower.includes('msp')) &&
        (destLower.includes('downtown') || destLower.includes('minneapolis'))) {
        return 15;
    }

    if ((originLower.includes('airport') || originLower.includes('msp')) &&
        destLower.includes('mall of america')) {
        return 5;
    }

    return 12;
}

function showPriceDisplay() {
    elements.priceDisplay.classList.remove('hidden');
    elements.priceValue.textContent = state.price;
    elements.distanceValue.textContent = state.distance;

    elements.priceDisplay.classList.add('price-pulse');
    setTimeout(() => {
        elements.priceDisplay.classList.remove('price-pulse');
    }, 500);
}

function updatePriceDisplay() {
    if (elements.priceValue) {
        elements.priceValue.textContent = state.price;
        elements.priceValue.parentElement.classList.add('price-pulse');
        setTimeout(() => {
            elements.priceValue.parentElement.classList.remove('price-pulse');
        }, 400);
    }
}

function setLoadingState(loading) {
    if (elements.submitBtn) {
        elements.submitBtn.disabled = loading;

        if (loading) {
            elements.submitText.innerHTML = `
                <svg class="w-5 h-5 loading-spinner" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Calculating...
            `;
        } else {
            elements.submitText.textContent = state.quoteCalculated ? 'Reserve This Car' : 'Get Instant Quote';
        }
    }
}

function redirectToBooking() {
    const bookingData = {
        pickup: elements.pickupInput.value,
        dropoff: elements.dropoffInput.value,
        pickupValid: state.pickupValid,
        dropoffValid: state.dropoffValid,
        date: state.date,
        time: state.time,
        vehicle: state.vehicle,
        distance: state.distance,
        duration: state.duration,
        price: state.price,
        startStep: 2 // Quote already calculated — skip to contact details
    };
    sessionStorage.setItem('tcb_booking', JSON.stringify(bookingData));

    window.location.href = CONFIG.bookingPage;
}

// =============================================================================
// GOOGLE PLACES AUTOCOMPLETE
// =============================================================================

function initAutocomplete() {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        setTimeout(initAutocomplete, 500);
        return;
    }

    const options = {
        bounds: new google.maps.LatLngBounds(
            new google.maps.LatLng(44.7, -94.0),
            new google.maps.LatLng(45.2, -93.0)
        ),
        componentRestrictions: { country: 'us' },
        strictBounds: false
    };

    if (elements.pickupInput) {
        const pickupAutocomplete = new google.maps.places.Autocomplete(
            elements.pickupInput,
            options
        );

        pickupAutocomplete.addListener('place_changed', () => {
            const place = pickupAutocomplete.getPlace();
            if (place && place.formatted_address) {
                state.pickup = elements.pickupInput.value;
                state.pickupValid = true;
                elements.pickupInput.classList.remove('input-error');

                const errorMsg = elements.pickupInput.parentNode.querySelector('.error-message');
                if (errorMsg) errorMsg.remove();

                if (state.quoteCalculated && state.dropoffValid) {
                    recalculateWithNewAddresses();
                }
            }
        });

        elements.pickupInput.addEventListener('input', () => {
            state.pickupValid = false;
        });
    }

    if (elements.dropoffInput) {
        const dropoffAutocomplete = new google.maps.places.Autocomplete(
            elements.dropoffInput,
            options
        );

        dropoffAutocomplete.addListener('place_changed', () => {
            const place = dropoffAutocomplete.getPlace();
            if (place && place.formatted_address) {
                state.dropoff = elements.dropoffInput.value;
                state.dropoffValid = true;
                elements.dropoffInput.classList.remove('input-error');

                const errorMsg = elements.dropoffInput.parentNode.querySelector('.error-message');
                if (errorMsg) errorMsg.remove();

                if (state.quoteCalculated && state.pickupValid) {
                    recalculateWithNewAddresses();
                }
            }
        });

        elements.dropoffInput.addEventListener('input', () => {
            state.dropoffValid = false;
        });
    }
}

// =============================================================================
// FAQ ACCORDION
// =============================================================================

function initFAQ() {
    if (!elements.faqContainer) return;

    const faqItems = elements.faqContainer.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const trigger = item.querySelector('.faq-trigger');
        if (!trigger) return;

        trigger.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            faqItems.forEach(i => i.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        });
    });
}

// =============================================================================
// SMOOTH SCROLL
// =============================================================================

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();

                const headerHeight = elements.header ? elements.header.offsetHeight : 0;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// =============================================================================
// REVEAL ANIMATIONS
// =============================================================================

function initRevealAnimations() {
    const revealElements = document.querySelectorAll('.reveal, .stagger-children');

    if (!revealElements.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
}

// =============================================================================
// UTILITIES
// =============================================================================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showToast(message, type = 'info') {
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
}

function formatTime(timeStr) {
    const [hours, minutes] = timeStr.split(':');
    const date = new Date();
    date.setHours(parseInt(hours, 10), parseInt(minutes, 10));
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

// =============================================================================
// CONTINUE BOOKING BANNER (Home Page)
// =============================================================================

function checkForSavedBooking() {
    const STORAGE_KEY = 'tcb_booking_draft';
    const banner = document.getElementById('continue-booking-banner');
    const infoElement = document.getElementById('saved-booking-info');
    const dismissBtn = document.getElementById('dismiss-continue-banner');

    if (!banner) return; // Not on home page

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            // Only surface drafts from the last 24 hours
            if (data.savedAt && Date.now() - data.savedAt < 24 * 60 * 60 * 1000) {
                banner.classList.remove('hidden');

                if (infoElement && data.pickup) {
                    const pickupShort = data.pickup.split(',')[0];
                    const dropoffShort = data.dropoff ? data.dropoff.split(',')[0] : '';
                    if (pickupShort && dropoffShort) {
                        infoElement.textContent = `${pickupShort} → ${dropoffShort}`;
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error checking saved booking:', e);
    }

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            banner.classList.add('hidden');
            sessionStorage.setItem('tcb_banner_dismissed', 'true');
        });
    }

    if (sessionStorage.getItem('tcb_banner_dismissed')) {
        banner.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', checkForSavedBooking);

// =============================================================================
// EXPORT FOR BOOKING PAGE
// =============================================================================

window.TCBlackCar = {
    CONFIG,
    calculatePrice,
    calculateHourlyPrice,
    isAirportAddress,
    getDistance,
    showToast,
    formatCurrency,
    formatDate,
    formatTime
};
