import React, { useEffect, useRef, useState } from "react"
import { Stage, Layer, Line } from "react-konva"
import { supabase } from "../lib/supabase"
import { v4 as uuidv4 } from "uuid"

interface Point {
  x: number
  y: number
}

interface Stroke {
  id: string
  color: string
  thickness: number
  points: number[] // flat array for Konva
}

interface SupabaseStroke {
  id: string
  color: string
  thickness: number
  points: Point[] // JSON from DB
  created_at: string
}

const Canvas: React.FC = () => {
  const [lines, setLines] = useState<Stroke[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [color, setColor] = useState("#ff0000")
  const [thickness, setThickness] = useState(4)
  const stageRef = useRef<any>(null)
  const lastLineRef = useRef<Stroke | null>(null)

  // 1️⃣ Fetch existing strokes on mount
  useEffect(() => {
    const fetchStrokes = async () => {
      const { data } = await supabase
        .from("strokes")
        .select("*")
        .order("created_at", { ascending: true })

      if (data) {
        const formatted = data.map(s => ({
          id: s.id,
          color: s.color,
          thickness: s.thickness,
          points: s.points.flatMap(p => [p.x, p.y]),
        }))
        setLines(formatted)
      }
    }
    fetchStrokes()
  }, [])

  // 2️⃣ Subscribe to new strokes in real-time
  useEffect(() => {
    const subscription = supabase
      .channel("realtime:strokes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "strokes" }, payload => {
        const s = payload.new as SupabaseStroke
        const stroke: Stroke = {
          id: s.id,
          color: s.color,
          thickness: s.thickness,
          points: s.points.flatMap(p => [p.x, p.y]),
        }
        setLines(prev => {
          // Avoid duplicates
          if (prev.some(l => l.id === stroke.id)) return prev
          return [...prev, stroke]
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [])

  // 3️⃣ Push partial stroke points while drawing
  useEffect(() => {
    if (!isDrawing || !lastLineRef.current) return

    const interval = setInterval(async () => {
      const line = lastLineRef.current
      if (!line) return

      const pointsArray: Point[] = []
      for (let i = 0; i < line.points.length; i += 2) {
        pointsArray.push({ x: line.points[i], y: line.points[i + 1] })
      }

      await supabase
        .from("strokes")
        .upsert([
          { id: line.id, color: line.color, thickness: line.thickness, points: pointsArray },
        ])
    }, 100)

    return () => clearInterval(interval)
  }, [isDrawing])

  // 4️⃣ Poll
  // useEffect(() => {
  //   const interval = setInterval(async () => {
  //     const { data } = await supabase
  //       .from<SupabaseStroke>("strokes")
  //       .select("*")
  //       .order("created_at", { ascending: true })

  //     if (data) {
  //       const formatted = data.map(s => ({
  //         id: s.id,
  //         color: s.color,
  //         thickness: s.thickness,
  //         points: s.points.flatMap(p => [p.x, p.y]),
  //       }))

  //       setLines(prev => {
  //         // Only update if new strokes are available
  //         const prevIds = new Set(prev.map(l => l.id))
  //         const newStrokes = formatted.filter(f => !prevIds.has(f.id))
  //         if (newStrokes.length === 0) return prev
  //         return [...prev, ...newStrokes]
  //       })
  //     }
  //   }, 1000) // fetch every 1 second

  //   return () => clearInterval(interval)
  // }, [])

  // Helper function to get pointer position (works for both mouse and touch)
  const getPointerPosition = (e: any) => {
    const stage = e.target.getStage()
    if (e.evt && e.evt.touches && e.evt.touches.length > 0) {
      // Touch event
      const touch = e.evt.touches[0]
      const rect = stage.container().getBoundingClientRect()
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      }
    }
    // Mouse event
    return stage.getPointerPosition()
  }

  // Drawing events (works for both mouse and touch)
  const handlePointerDown = (e: any) => {
    e.evt.preventDefault() // Prevent default touch behaviors
    const pos = getPointerPosition(e)
    if (!pos) return

    const newLine: Stroke = {
      id: uuidv4(),
      color,
      thickness,
      points: [pos.x, pos.y],
    }

    lastLineRef.current = newLine
    setLines(prev => [...prev, newLine])
    setIsDrawing(true)
  }

  const handlePointerMove = (e: any) => {
    if (!isDrawing || !lastLineRef.current) return
    e.evt.preventDefault() // Prevent scrolling while drawing
    const point = getPointerPosition(e)
    if (!point) return

    lastLineRef.current.points = lastLineRef.current.points.concat([point.x, point.y])
    setLines(prev => [...prev.slice(0, -1), lastLineRef.current!])
  }

  const handlePointerUp = async (e: any) => {
    e.evt.preventDefault()
    setIsDrawing(false)
    if (!lastLineRef.current) return

    const pointsArray: Point[] = []
    for (let i = 0; i < lastLineRef.current.points.length; i += 2) {
      pointsArray.push({ x: lastLineRef.current.points[i], y: lastLineRef.current.points[i + 1] })
    }

    await supabase.from("strokes").upsert([
      {
        id: lastLineRef.current.id,
        color: lastLineRef.current.color,
        thickness: lastLineRef.current.thickness,
        points: pointsArray,
      },
    ])

    lastLineRef.current = null
  }

  // Clear canvas
  const clearCanvas = async () => {
    setLines([])
    await supabase.from("strokes").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  }

  return (
    <div>
      <div style={{ marginBottom: 10, display: "flex", gap: "10px", alignItems: "center" }}>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        <input
          type="number"
          value={thickness}
          min={1}
          max={20}
          onChange={e => setThickness(Number(e.target.value))}
        />
        <button
          onClick={clearCanvas}
          style={{
            padding: "8px 16px",
            backgroundColor: "#ff4444",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Clear Canvas
        </button>
      </div>
      <Stage
        width={window.innerWidth}
        height={window.innerHeight}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        ref={stageRef}
        style={{ touchAction: "none" }}
      >
        <Layer>
          {lines.map(line => (
            <Line
              key={line.id}
              points={line.points}
              stroke={line.color}
              strokeWidth={line.thickness}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation="source-over"
            />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}

export default Canvas
