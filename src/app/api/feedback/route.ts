import { NextRequest, NextResponse } from "next/server";
import { updateUserRating, getTaskById } from "@/lib/db/queries";

export async function POST(request: NextRequest) {
  let body: { taskId?: string; rating?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error", code: "invalid_json" } },
      { status: 400 }
    );
  }

  const { taskId, rating } = body;

  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json(
      { error: { message: "taskId is required", type: "invalid_request_error", code: "missing_task_id" } },
      { status: 400 }
    );
  }

  if (rating === undefined || typeof rating !== "number" || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: { message: "rating must be 1-5", type: "invalid_request_error", code: "invalid_rating" } },
      { status: 400 }
    );
  }

  const task = await getTaskById(taskId);
  if (!task) {
    return NextResponse.json(
      { error: { message: "Task not found", type: "invalid_request_error", code: "not_found" } },
      { status: 404 }
    );
  }

  await updateUserRating(taskId, rating);

  return NextResponse.json({
    success: true,
    taskId,
    rating,
    taskCategory: task.taskCategory,
    modelSelected: task.modelSelected,
  });
}
