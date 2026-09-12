"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { trackedInvoke } from "@/lib/tauri"

export function Greet() {
  const [name, setName] = useState("")
  const [greeting, setGreeting] = useState("")

  async function handleGreet() {
    const result = await trackedInvoke<string>("greet", {
      name: name.trim() || "World",
    })

    setGreeting(result)
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-4 space-y-1">
        <h2 className="font-medium">Rust bridge</h2>
        <p className="text-sm text-muted-foreground">
          Call the bundled Tauri command and render the response from Rust.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Enter a name"
        />
        <Button onClick={handleGreet} disabled={!name.trim()}>
          Greet
        </Button>
      </div>
      {greeting ? (
        <p className="mt-3 text-sm text-muted-foreground">{greeting}</p>
      ) : null}
    </div>
  )
}
