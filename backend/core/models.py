from django.db import models

class WhiteboardRoom(models.Model):
    """
    Stores the persistent state of a Yjs document for a whiteboard room.
    """
    room_id = models.CharField(max_length=255, unique=True, primary_key=True, help_text="Unique identifier for the whiteboard room")
    # Use BinaryField to store the Yjs document state update blob
    state = models.BinaryField(null=True, blank=True, help_text="Serialized Yjs document state")
    updated_at = models.DateTimeField(auto_now=True, help_text="Timestamp of the last update")

    def __str__(self):
        return f"Whiteboard Room: {self.room_id}"
