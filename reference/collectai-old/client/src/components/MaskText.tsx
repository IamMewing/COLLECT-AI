import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface MaskTextProps {
  text: string;
  delay?: number;
  duration?: number;
  stagger?: number;
  className?: string;
}

export const MaskText: React.FC<MaskTextProps> = ({ 
  text, 
  delay = 0, 
  duration = 0.5, 
  stagger = 0.02, 
  className = '' 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Select all split word elements
    const words = containerRef.current.querySelectorAll('.word-inner');
    
    gsap.fromTo(words, 
      {
        y: '100%',
        opacity: 0
      },
      {
        y: '0%',
        opacity: 1,
        duration: duration,
        stagger: stagger,
        delay: delay,
        ease: 'power3.out',
        overwrite: 'auto'
      }
    );
  }, [text, delay, duration, stagger]);

  // Split text by space
  const wordsArray = text.split(' ');

  return (
    <div 
      ref={containerRef} 
      className={`mask-text-container ${className}`}
      style={{ display: 'inline-flex', flexWrap: 'wrap', overflow: 'hidden' }}
    >
      {wordsArray.map((word, idx) => (
        <span 
          key={idx} 
          className="word-outer"
          style={{ 
            display: 'inline-block', 
            overflow: 'hidden', 
            marginRight: '0.28em', 
            lineHeight: '1.2' 
          }}
        >
          <span 
            className="word-inner" 
            style={{ 
              display: 'inline-block',
              transform: 'translateY(100%)',
              opacity: 0
            }}
          >
            {word}
          </span>
        </span>
      ))}
    </div>
  );
};
