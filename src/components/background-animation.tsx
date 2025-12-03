'use client';

import React, { useEffect } from 'react';
import { FlaskConical } from 'lucide-react';

export function BackgroundAnimation() {
  useEffect(() => {
    const container = document.getElementById('background-animation');
    if (!container) return;

    const createBubble = () => {
      if (document.hidden) return; // Don't create bubbles when tab is not active
      const bubble = document.createElement('div');
      const size = Math.random() * 40 + 10; // 10px to 50px
      const duration = Math.random() * 10 + 10; // 10s to 20s
      const delay = Math.random() * 5; // 0s to 5s
      const left = Math.random() * 100;

      bubble.className = 'bubble';
      bubble.style.width = `${size}px`;
      bubble.style.height = `${size}px`;
      bubble.style.left = `${left}vw`;
      bubble.style.animationDuration = `${duration}s`;
      bubble.style.animationDelay = `${delay}s`;

      container.appendChild(bubble);

      setTimeout(() => {
        bubble.remove();
      }, (duration + delay) * 1000);
    };
    
    const createTestTube = () => {
        if (document.hidden) return;
        const tube = document.createElement('div');
        const size = Math.random() * 60 + 40; // 40px to 100px
        const duration = Math.random() * 15 + 15; // 15s to 30s
        const delay = Math.random() * 10; // 0s to 10s
        const left = Math.random() * 100;

        tube.className = 'test-tube';
        tube.style.left = `${left}vw`;
        tube.style.animationDuration = `${duration}s`;
        tube.style.animationDelay = `${delay}s`;
        tube.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5h0c-1.4 0-2.5-1.1-2.5-2.5V2"/><path d="M8.5 2h7"/><path d="M14.5 16h-5"/></svg>`;

        container.appendChild(tube);

        setTimeout(() => {
            tube.remove();
        }, (duration + delay) * 1000);
    }

    const bubbleInterval = setInterval(createBubble, 500);
    const tubeInterval = setInterval(createTestTube, 2000);

    return () => {
      clearInterval(bubbleInterval);
      clearInterval(tubeInterval);
    };
  }, []);

  return <div id="background-animation" className="fixed inset-0 w-full h-full -z-10" />;
}
