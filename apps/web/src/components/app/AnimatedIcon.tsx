import { LottieSubscription, LottieSvg, type LottieHandle } from "lottie-react";
import type { LucideIcon } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

// Animações geradas por scripts/build-nav-icons.mjs (traço branco)
const ANIMATIONS = import.meta.glob<{ default: object }>("../../assets/nav-icons/*.json", { eager: true });
const byName = (name: string) => ANIMATIONS[`../../assets/nav-icons/${name}.json`]?.default;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type AnimatedIconHandle = { play: () => void };

/**
 * Ícone 18×18 que toca uma animação curta quando o item é focado/hovered (quem chama `play()` é o link).
 * Sem JSON para o nome: usa o ícone estático do lucide com micro-animação no hover do grupo.
 */
export const AnimatedIcon = forwardRef<AnimatedIconHandle, { name: string; fallback: LucideIcon; className?: string }>(
  function AnimatedIcon({ name, fallback: Fallback, className }, ref) {
    const lottie = useRef<LottieHandle>(null);
    const playing = useRef(false);
    const data = byName(name);

    useImperativeHandle(ref, () => ({
      play: () => {
        if (!data || reducedMotion() || playing.current) return;
        playing.current = true;
        lottie.current?.seek(0);
        lottie.current?.play();
      },
    }));

    if (!data) {
      return (
        <Fallback
          className={cn("size-[18px] shrink-0 opacity-80 transition-transform duration-200 motion-safe:group-hover:-translate-y-px motion-safe:group-hover:-rotate-6", className)}
        />
      );
    }

    return (
      <span className={cn("grid size-[18px] shrink-0 place-items-center opacity-80 invert dark:invert-0", className)} aria-hidden>
        <LottieSvg
          lottieRef={lottie}
          src={data}
          autoplay={false}
          loop={false}
          subscriptions={{
            // Ao terminar (o mouse pode já ter saído), volta para o quadro 0
            [LottieSubscription.complete]: () => {
              playing.current = false;
              lottie.current?.stop();
            },
          }}
          style={{ width: 18, height: 18 }}
        />
      </span>
    );
  },
);
