import { useState } from 'react'
import { GitMerge } from 'lucide-react'

import Button from '@/components/ui/Button'
import { controlButtonVariant } from '@/lib/constants'
import GraphFusionDialog from '@/components/graph/GraphFusionDialog'

export default function GraphFusionControl() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant={controlButtonVariant}
        tooltip="图谱融合（按 graph_tag）"
        size="icon"
        type="button"
        onClick={() => setOpen(true)}
      >
        <GitMerge />
      </Button>
      <GraphFusionDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
