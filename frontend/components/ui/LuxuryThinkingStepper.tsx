import React, { useState, useEffect } from 'react';

interface LuxuryThinkingStepperProps {
    isLoading: boolean;
    steps: string[];
}

export function LuxuryThinkingStepper({ isLoading, steps }: LuxuryThinkingStepperProps) {
    const [activeStepIndex, setActiveStepIndex] = useState(0);

    useEffect(() => {
        let intervalId: any;
        if (isLoading) {
            setActiveStepIndex(0);
            intervalId = setInterval(() => {
                setActiveStepIndex(prev => {
                    if (prev < steps.length - 1) return prev + 1;
                    return prev;
                });
            }, 1500);
        } else {
            setActiveStepIndex(0);
        }
        return () => clearInterval(intervalId);
    }, [isLoading, steps.length]);

    if (!isLoading) return null;

    return (
        <div className="space-y-4 py-2">
            {steps.map((step, index) => {
                const isCompleted = index < activeStepIndex;
                const isActive = index === activeStepIndex;
                const isPending = index > activeStepIndex;
                const isLast = index === steps.length - 1;

                return (
                    <div key={index} className={`flex items-start gap-4 relative ${!isLast ? 'before:absolute before:left-[9px] before:top-[24px] before:-bottom-[8px] before:w-[1px] before:bg-white/10' : ''}`}>
                        <div className="mt-1 flex items-center justify-center relative z-10 bg-inherit shrink-0 rounded-full w-5 h-5">
                            {isCompleted && (
                                <svg className="w-3 h-3 text-[#D4AF37]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            )}
                            {isActive && (
                                <>
                                    <div className="absolute inset-0 rounded-full bg-[#D4AF37]/20 animate-ping"></div>
                                    <div className="w-2 h-2 rounded-full bg-[#D4AF37] shadow-[0_0_8px_rgba(212,175,55,0.8)]"></div>
                                </>
                            )}
                            {isPending && (
                                <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                            )}
                        </div>
                        <div className={`text-sm ${isActive ? 'text-white font-medium animate-pulse' : isCompleted ? 'text-white/70' : 'text-white/30'} transition-all duration-300`}>
                            {step}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
