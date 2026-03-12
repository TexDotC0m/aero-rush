const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const uiMainMenu = document.getElementById('main-menu');
const uiHud = document.getElementById('hud');
const uiGameOver = document.getElementById('game-over');
const scoreDisplay = document.getElementById('score');
const finalScoreDisplay = document.getElementById('final-score');
const bestScoreDisplay = document.getElementById('best-score');
const fuelFill = document.getElementById('fuel-fill');
const windWarning = document.getElementById('wind-warning');
const windText = document.getElementById('wind-text');
const fogWarning = document.getElementById('fog-warning');
const btnPlay = document.getElementById('play-btn');
const btnRestart = document.getElementById('restart-btn');

// Game Constants
const STATE_MENU = 0;
const STATE_PLAYING = 1;
const STATE_GAMEOVER = 2;

let currentState = STATE_MENU;
let lastTime = 0;
let rafId = null;

// Adjust Canvas Size
function resizeCanvas() {
    const container = document.getElementById('game-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Game State Variables
let score = 0;
let highScore = localStorage.getItem('aeroRushHighScore') || 0;
let baseSpeed = 300; // pixels per second (horizontal equivalent for obstacles)
let currentSpeed = baseSpeed;
let fuel = 100;
const MAX_FUEL = 100;
const FUEL_DRATE = 5; // Reduced from 10 to make fuel last longer
let frameCount = 0;
let fogAlpha = 0; // Current fog opacity

// Environment (Wind)
let windActive = false;
let windForceY = 0; // Negative = up, Positive = down
let windTimer = 0;
let nextWindTime = getRandom(5, 15); // Seconds until next wind

function getRandom(min, max) {
    return Math.random() * (max - min) + min;
}

// Player Entity (Airplane)
class Player {
    constructor() {
        this.width = 40;
        this.height = 30;
        this.x = 100; // Fixed horizontal position
        this.y = canvas.height / 2;
        this.vy = 0;
        this.gravity = 1500; // px/s^2
        this.jumpImpulse = -500; // px/s
        this.rotation = 0;
        this.color = '#ffeb3b'; // Cartoon yellow plane core
    }

    reset() {
        this.y = canvas.height / 2;
        this.vy = 0;
        this.rotation = 0;
    }

    jump() {
        this.vy = this.jumpImpulse;
    }

    update(dt) {
        // Apply wind
        let totalForce = this.gravity;
        if (windActive) {
            totalForce += windForceY;
        }

        // Apply physics
        this.vy += totalForce * dt;
        this.y += this.vy * dt;

        // Rotation based on Y velocity
        // Clamp rotation between -30deg and +90deg
        const targetRotation = Math.max(-Math.PI/6, Math.min(Math.PI/2, this.vy * 0.003));
        this.rotation += (targetRotation - this.rotation) * 10 * dt;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        // Simple Airplane shape
        ctx.fillStyle = this.color;
        
        // Body (Ellipse-like rectangle with rounded corners)
        ctx.beginPath();
        ctx.roundRect(-this.width/2, -this.height/2, this.width, this.height * 0.8, 10);
        ctx.fill();

        // Cockpit window
        ctx.fillStyle = '#4BCFFA';
        ctx.beginPath();
        ctx.arc(this.width/4 - 2, -this.height/4, 6, 0, Math.PI * 2);
        ctx.fill();

        // Wing
        ctx.fillStyle = '#f39c12';
        ctx.beginPath();
        ctx.ellipse(0, 0, 15, 5, -0.2, 0, Math.PI * 2);
        ctx.fill();

        // Tail
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(-this.width/2 + 5, -this.height/2);
        ctx.lineTo(-this.width/2 - 5, -this.height/2 - 12);
        ctx.lineTo(-this.width/2 + 10, -this.height/2 - 10);
        ctx.fill();

        ctx.restore();
    }
}

// Obstacle (Clouds)
class Obstacle {
    constructor(x) {
        this.x = x;
        this.width = 60;
        // Gap height decreases slightly as score increases (starts easier)
        const difficultyRatio = Math.min(score / 50, 1);
        this.gap = 220 - (difficultyRatio * 60); 
        this.passed = false;

        // Random Y position for the gap
        const minGapY = 50;
        const maxGapY = canvas.height - 50 - this.gap;
        this.gapY = getRandom(minGapY, maxGapY);
        
        this.markedForDeletion = false;
    }

    update(dt) {
        this.x -= currentSpeed * dt;
        if (this.x + this.width < 0) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
        ctx.fillStyle = '#ffffff';
        // Add some depth/shadow to clouds
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;

        // Top cloud
        this.drawCloudShape(ctx, this.x, 0, this.width, this.gapY);
        // Bottom cloud
        this.drawCloudShape(ctx, this.x, this.gapY + this.gap, this.width, canvas.height - (this.gapY + this.gap));
        
        ctx.shadowColor = 'transparent';
    }

    drawCloudShape(ctx, x, y, width, height) {
        // Simplifying to vertical rounded rectangles for now
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 15);
        ctx.fill();
    }

    checkCollision(player) {
        // AABB Collision (simplified plane as rectangle)
        const margin = 8; // forgiving margin
        const pLeft = player.x - player.width/2 + margin;
        const pRight = player.x + player.width/2 - margin;
        const pTop = player.y - player.height/2 + margin;
        const pBottom = player.y + player.height/2 - margin;

        const oLeft = this.x;
        const oRight = this.x + this.width;

        if (pRight > oLeft && pLeft < oRight) {
            // Hit top cloud
            if (pTop < this.gapY) return true;
            // Hit bottom cloud
            if (pBottom > this.gapY + this.gap) return true;
        }
        return false;
    }
}

class FuelCollectible {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 20;
        this.height = 25;
        this.markedForDeletion = false;
        this.floatOffset = Math.random() * Math.PI * 2;
    }

    update(dt) {
        this.x -= currentSpeed * dt;
        if (this.x + this.width < 0) {
            this.markedForDeletion = true;
        }
    }

    draw(ctx) {
        // Floating up and down effect
        const currentY = this.y + Math.sin((performance.now() / 200) + this.floatOffset) * 5;

        ctx.fillStyle = '#e74c3c'; // Red gasoline can
        ctx.fillRect(this.x, currentY, this.width, this.height);
        
        // Cap
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(this.x + 5, currentY - 4, 10, 4);

        // Logo/mark
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.arc(this.x + this.width/2, currentY + this.height/2, 4, 0, Math.PI*2);
        ctx.fill();
    }

    checkCollision(player) {
        const pLeft = player.x - player.width/2;
        const pRight = player.x + player.width/2;
        const pTop = player.y - player.height/2;
        const pBottom = player.y + player.height/2;

        const currentY = this.y + Math.sin((performance.now() / 200) + this.floatOffset) * 5;

        if (pRight > this.x && pLeft < this.x + this.width &&
            pBottom > currentY && pTop < currentY + this.height) {
            return true;
        }
        return false;
    }
}

// Background Clouds for Parallax
class BackgroundCloud {
    constructor() {
        this.x = canvas.width + getRandom(0, 200);
        this.y = getRandom(50, canvas.height - 150);
        this.speedMultiplier = getRandom(0.1, 0.4);
        this.size = getRandom(30, 80);
        this.markedForDeletion = false;
        this.opacity = getRandom(0.2, 0.6);
    }
    
    update(dt) {
        this.x -= currentSpeed * this.speedMultiplier * dt;
        if (this.x + this.size * 2 < 0) {
            this.markedForDeletion = true;
        }
    }
    
    draw(ctx) {
        ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
        ctx.beginPath();
        // Simple fluffy shape
        ctx.arc(this.x, this.y, this.size * 0.5, Math.PI * 0.5, Math.PI * 1.5);
        ctx.arc(this.x + this.size * 0.5, this.y - this.size * 0.2, this.size * 0.4, Math.PI * 1, Math.PI * 2);
        ctx.arc(this.x + this.size, this.y, this.size * 0.5, Math.PI * 1.5, Math.PI * 0.5);
        ctx.fill();
    }
}

let player = new Player();
let obstacles = [];
let collectibles = [];
let bgClouds = [];

let obstacleSpawnTimer = 0;
let bgCloudTimer = 0;

function resetGame() {
    player.reset();
    obstacles = [];
    collectibles = [];
    bgClouds = [];
    score = 0;
    fuel = MAX_FUEL;
    currentSpeed = baseSpeed;
    windActive = false;
    windTimer = 0;
    nextWindTime = getRandom(5, 15);
    updateHUD();
    windWarning.classList.add('hidden');
    fogWarning.classList.add('hidden');
    fogAlpha = 0;
    spawnBackgroundClouds(10); // Pre-fill background
}

function spawnBackgroundClouds(count) {
    for(let i=0; i<count; i++) {
        let bgCloud = new BackgroundCloud();
        bgCloud.x = getRandom(0, canvas.width); // Spread them out
        bgClouds.push(bgCloud);
    }
}

function updateState(newState) {
    currentState = newState;
    uiMainMenu.classList.add('hidden');
    uiMainMenu.classList.remove('active');
    uiHud.classList.add('hidden');
    uiGameOver.classList.add('hidden');
    uiGameOver.classList.remove('active');

    if (currentState === STATE_MENU) {
        uiMainMenu.classList.remove('hidden');
        uiMainMenu.classList.add('active');
        resetGame();
    } else if (currentState === STATE_PLAYING) {
        uiHud.classList.remove('hidden');
        lastTime = performance.now();
        player.jump(); // Initial jump
    } else if (currentState === STATE_GAMEOVER) {
        uiGameOver.classList.remove('hidden');
        uiGameOver.classList.add('active');
        finalScoreDisplay.textContent = score;
        if (score > highScore) {
            highScore = score;
            localStorage.setItem('aeroRushHighScore', highScore);
        }
        bestScoreDisplay.textContent = highScore;
        
        // Tremble effect on canvas for death
        document.getElementById('game-container').style.transform = 'translate(10px, 10px)';
        setTimeout(() => {
            document.getElementById('game-container').style.transform = 'translate(-10px, -10px)';
            setTimeout(() => {
                document.getElementById('game-container').style.transform = 'translate(0, 0)';
            }, 50);
        }, 50);
    }
}

function updateHUD() {
    scoreDisplay.textContent = score;
    const fuelPercent = Math.max(0, (fuel / MAX_FUEL) * 100);
    fuelFill.style.width = fuelPercent + '%';
    
    if (fuelPercent < 20) {
        fuelFill.classList.add('danger');
    } else {
        fuelFill.classList.remove('danger');
    }
}

function gameOver() {
    updateState(STATE_GAMEOVER);
}

function mainLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000; // Delta time in seconds
    lastTime = timestamp;

    if (currentState === STATE_PLAYING) {
        // Cap dt to prevent huge jumps if tab was inactive
        if (dt < 0.1) {
            updateGame(dt);
        }
    }
    
    // Always draw so we see background in menus and last frame on game over
    drawGame();

    rafId = requestAnimationFrame(mainLoop);
}

function updateGame(dt) {
    frameCount++;

    // Mechanics
    player.update(dt);
    
    // Fuel mechanics
    fuel -= FUEL_DRATE * dt;
    if (fuel <= 0) {
        fuel = 0;
        // Gravity pulls down, player can't jump anymore
    }
    updateHUD();

    // Screen bounds collision
    if (player.y - player.height/2 < 0 || player.y + player.height/2 > canvas.height) {
        gameOver();
        return;
    }

    // Speed progression
    currentSpeed = baseSpeed + (score * 5);

    // Wind Logic
    if (windActive) {
        windTimer -= dt;
        if (windTimer <= 0) {
            windActive = false;
            windWarning.classList.add('hidden');
            nextWindTime = getRandom(8, 20); // time until next wind
        }
    } else {
        nextWindTime -= dt;
        if (nextWindTime <= 0) {
            windActive = true;
            windTimer = getRandom(2, 4); // wind lasts 2-4 seconds
            
            const isUpDraft = Math.random() > 0.5;
            windForceY = isUpDraft ? -400 : 400; // Reduced force slightly to be fairer
            
            windText.textContent = isUpDraft ? 'Updraft!' : 'Downdraft!';
            windWarning.classList.remove('hidden');
        }
    }

    // Fog Logic - After 5 points
    if (score >= 5) {
        if (fogAlpha < 0.7) {
            fogAlpha += 0.1 * dt; // Gradually thicken the fog
        }
        fogWarning.classList.remove('hidden');
    } else {
        fogAlpha = 0;
        fogWarning.classList.add('hidden');
    }

    // Background Clouds
    bgCloudTimer += dt;
    if (bgCloudTimer > 1) { 
        if (Math.random() > 0.5) {
            bgClouds.push(new BackgroundCloud());
        }
        bgCloudTimer = 0;
    }
    bgClouds.forEach(bgc => bgc.update(dt));
    bgClouds = bgClouds.filter(bgc => !bgc.markedForDeletion);

    // Obstacle Spawning
    const distanceBetweenObstacles = 350; // pixels (made slightly wider for fairness)
    obstacleSpawnTimer += currentSpeed * dt;
    
    if (obstacleSpawnTimer > distanceBetweenObstacles) {
        obstacles.push(new Obstacle(canvas.width));
        obstacleSpawnTimer = 0;
        
        // Spawn fuel inside the gap occasionally (30% chance)
        if (Math.random() < 0.3) {
            const lastObs = obstacles[obstacles.length-1];
            const fuelY = lastObs.gapY + lastObs.gap/2 - 10;
            collectibles.push(new FuelCollectible(canvas.width + lastObs.width/2 - 10, fuelY));
        }
    }

    // Update Obstacles
    obstacles.forEach(obs => {
        obs.update(dt);
        if (obs.checkCollision(player)) {
            gameOver();
            return;
        }

        // Score logic
        if (!obs.passed && player.x > obs.x + obs.width) {
            obs.passed = true;
            score++;
            // Small score float effect could be added here
            scoreDisplay.style.transform = 'scale(1.2)';
            setTimeout(() => {
                scoreDisplay.style.transform = 'scale(1)';
            }, 100);
            updateHUD();
        }
    });
    obstacles = obstacles.filter(obs => !obs.markedForDeletion);

    // Update Collectibles
    collectibles.forEach(col => {
        col.update(dt);
        if (col.checkCollision(player)) {
            col.markedForDeletion = true;
            fuel = Math.min(MAX_FUEL, fuel + 30); // Restore 30 fuel
            updateHUD();
        }
    });
    collectibles = collectibles.filter(col => !col.markedForDeletion);
}

function drawGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background clouds
    bgClouds.forEach(bgc => bgc.draw(ctx));

    // Draw Obstacles
    obstacles.forEach(obs => obs.draw(ctx));

    // Draw Collectibles
    collectibles.forEach(col => col.draw(ctx));

    // Draw Player
    player.draw(ctx);

    // Draw Fog Overlay
    if (fogAlpha > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${fogAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Add a slight "misty" texture by reducing visibility of the center
        const gradient = ctx.createRadialGradient(
            canvas.width/2, canvas.height/2, 50,
            canvas.width/2, canvas.height/2, canvas.width/1.2
        );
        gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
        gradient.addColorStop(1, `rgba(255, 255, 255, ${fogAlpha * 0.5})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// Input Handling
function handleInput(e) {
    if (e.type === 'keydown' && e.code !== 'Space') return;
    
    // Prevent default scrolling on space or touch
    if (e.cancelable) {
        e.preventDefault();
    }

    if (currentState === STATE_MENU) {
        // Handled by UI button
    } else if (currentState === STATE_PLAYING) {
        if (fuel > 0) {
            player.jump();
        }
    } else if (currentState === STATE_GAMEOVER) {
        // Handled by restart button
    }
}

window.addEventListener('keydown', handleInput);
// Use mousedown instead of click to prevent conflict with UI buttons where possible,
// but for the canvas, we can attach it directly.
canvas.addEventListener('mousedown', handleInput);
canvas.addEventListener('touchstart', handleInput, { passive: false });

btnPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    updateState(STATE_PLAYING);
});

btnRestart.addEventListener('click', (e) => {
    e.stopPropagation();
    updateState(STATE_MENU); // Clean reset
    updateState(STATE_PLAYING); // Instantly play again
});

// Initialize
updateState(STATE_MENU);
lastTime = performance.now();
rafId = requestAnimationFrame(mainLoop);
