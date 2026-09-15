import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === "dark"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className={`relative rounded-lg hover:bg-accent/80 transition-all duration-200 cursor-pointer ${className ?? ""}`}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          />
        }
      >
        <Sun className="h-4.5 w-4.5 rotate-0 scale-100 transition-transform duration-300 dark:-rotate-90 dark:scale-0 text-amber-500" />
        <Moon className="absolute h-4.5 w-4.5 rotate-90 scale-0 transition-transform duration-300 dark:rotate-0 dark:scale-100 text-sky-400" />
        <span className="sr-only">Toggle theme</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
      </TooltipContent>
    </Tooltip>
  )
}
