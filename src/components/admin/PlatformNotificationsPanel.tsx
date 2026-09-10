import { format } from "date-fns";
import {
  Bell,
  Calendar,
  Clock,
  Eye,
  Loader2,
  Mail,
  Palette,
  Save,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { usePlatformNotifications } from "@/hooks/usePlatformNotifications";

export function PlatformNotificationsPanel() {
  const {
    jurisdictions,
    selectedJurisdiction,
    setSelectedJurisdiction,
    notificationTitle,
    setNotificationTitle,
    notificationMessage,
    setNotificationMessage,
    sendEmailNotification,
    setSendEmailNotification,
    sending,
    loadingJurisdictions,
    showPreview,
    setShowPreview,
    editedBranding,
    setEditedBranding,
    savingBranding,
    loadingBranding,
    handleSaveBranding,
    handleSendNotification,
    handleScheduleNotification,
    handleDeleteScheduled,
    isScheduled,
    setIsScheduled,
    scheduledDate,
    setScheduledDate,
    scheduledTime,
    setScheduledTime,
    scheduledNotifications,
  } = usePlatformNotifications();

  const selectedJurisdictionMeta = jurisdictions.find(
    (j) => j.jurisdiction_id === selectedJurisdiction,
  );

  return (
    <>
      <Tabs defaultValue="notifications" className="space-y-6">
        <TabsList className="pilot-card flex h-auto w-full flex-wrap justify-start gap-1 bg-card p-1.5">
          <TabsTrigger
            value="notifications"
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          >
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger
            value="schedule"
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          >
            <Calendar className="h-4 w-4" />
            Schedule
          </TabsTrigger>
          <TabsTrigger
            value="branding"
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
          >
            <Palette className="h-4 w-4" />
            Email branding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Send code update notification
              </CardTitle>
              <CardDescription>
                Notify jurisdiction subscribers about code updates (in-app and optional email).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="jurisdiction">Jurisdiction</Label>
                {loadingJurisdictions ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : jurisdictions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No jurisdictions with subscribers.</p>
                ) : (
                  <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction}>
                    <SelectTrigger id="jurisdiction">
                      <SelectValue placeholder="Choose a jurisdiction…" />
                    </SelectTrigger>
                    <SelectContent>
                      {jurisdictions.map((j) => (
                        <SelectItem key={j.jurisdiction_id} value={j.jurisdiction_id}>
                          {j.jurisdiction_name}, {j.jurisdiction_state} ({j.subscriber_count}{" "}
                          subscriber{j.subscriber_count !== 1 ? "s" : ""})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={notificationTitle}
                  onChange={(e) => setNotificationTitle(e.target.value)}
                  placeholder="e.g., 2024 Building Code Update"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  rows={4}
                  value={notificationMessage}
                  onChange={(e) => setNotificationMessage(e.target.value)}
                  placeholder="Describe the code update…"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="sendEmail"
                  checked={sendEmailNotification}
                  onCheckedChange={(checked) => setSendEmailNotification(checked === true)}
                />
                <Label htmlFor="sendEmail" className="flex cursor-pointer items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Also send email
                </Label>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!selectedJurisdiction || !notificationTitle || !notificationMessage}
                  onClick={() => setShowPreview(true)}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
                <Button
                  className="flex-1"
                  disabled={
                    sending || !selectedJurisdiction || !notificationTitle || !notificationMessage
                  }
                  onClick={() => void handleSendNotification()}
                >
                  {sending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Send now
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {jurisdictions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Jurisdictions overview</CardTitle>
                <CardDescription>Active subscriber counts</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {jurisdictions.map((j) => (
                  <div key={j.jurisdiction_id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{j.jurisdiction_name}</p>
                      <p className="text-sm text-muted-foreground">{j.jurisdiction_state}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      {j.subscriber_count}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="schedule" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule notification
              </CardTitle>
              <CardDescription>Queue a future jurisdiction notification.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Jurisdiction</Label>
                <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a jurisdiction…" />
                  </SelectTrigger>
                  <SelectContent>
                    {jurisdictions.map((j) => (
                      <SelectItem key={j.jurisdiction_id} value={j.jurisdiction_id}>
                        {j.jurisdiction_name}, {j.jurisdiction_state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={notificationTitle} onChange={(e) => setNotificationTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  rows={3}
                  value={notificationMessage}
                  onChange={(e) => setNotificationMessage(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="scheduleEmail"
                  checked={sendEmailNotification}
                  onCheckedChange={(checked) => setSendEmailNotification(checked === true)}
                />
                <Label htmlFor="scheduleEmail">Include email delivery</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="enableSchedule"
                  checked={isScheduled}
                  onCheckedChange={(checked) => setIsScheduled(checked === true)}
                />
                <Label htmlFor="enableSchedule">Set schedule date/time</Label>
              </div>
              {isScheduled ? (
                <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="scheduleDate">Date</Label>
                    <Input
                      id="scheduleDate"
                      type="date"
                      min={format(new Date(), "yyyy-MM-dd")}
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scheduleTime">Time</Label>
                    <Input
                      id="scheduleTime"
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
              <Button
                className="w-full"
                disabled={
                  sending ||
                  !selectedJurisdiction ||
                  !notificationTitle ||
                  !notificationMessage ||
                  !scheduledDate ||
                  !scheduledTime
                }
                onClick={() => void handleScheduleNotification()}
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scheduling…
                  </>
                ) : (
                  <>
                    <Calendar className="mr-2 h-4 w-4" />
                    Schedule
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {scheduledNotifications.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Pending scheduled sends</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {scheduledNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="flex items-start justify-between gap-4 rounded-lg border p-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{notification.notification_title}</h4>
                        <Badge variant="outline" className="text-xs capitalize">
                          {notification.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{notification.jurisdiction_name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {format(new Date(notification.scheduled_for), "MMM d, yyyy h:mm a")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDeleteScheduled(notification.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Email template branding
              </CardTitle>
              <CardDescription>Customize jurisdiction notification emails.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBranding ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Header / brand name</Label>
                      <Input
                        value={editedBranding.header_text}
                        onChange={(e) =>
                          setEditedBranding((prev) => ({ ...prev, header_text: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Logo URL (optional)</Label>
                      <Input
                        value={editedBranding.logo_url || ""}
                        onChange={(e) =>
                          setEditedBranding((prev) => ({
                            ...prev,
                            logo_url: e.target.value || null,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Primary color</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={editedBranding.primary_color}
                          onChange={(e) =>
                            setEditedBranding((prev) => ({
                              ...prev,
                              primary_color: e.target.value,
                            }))
                          }
                          className="h-10 w-16 cursor-pointer p-1"
                        />
                        <Input
                          value={editedBranding.primary_color}
                          onChange={(e) =>
                            setEditedBranding((prev) => ({
                              ...prev,
                              primary_color: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Footer text</Label>
                      <Input
                        value={editedBranding.footer_text}
                        onChange={(e) =>
                          setEditedBranding((prev) => ({ ...prev, footer_text: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unsubscribe link text</Label>
                      <Input
                        value={editedBranding.unsubscribe_text}
                        onChange={(e) =>
                          setEditedBranding((prev) => ({
                            ...prev,
                            unsubscribe_text: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button
                      className="w-full"
                      disabled={savingBranding}
                      onClick={() => void handleSaveBranding()}
                    >
                      {savingBranding ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save branding
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-lg border bg-navy text-sm text-navy-foreground">
                    <div
                      className="px-4 py-3 text-center"
                      style={{ backgroundColor: editedBranding.primary_color }}
                    >
                      <h3 className="text-sm font-bold text-white">{editedBranding.header_text}</h3>
                    </div>
                    <div className="space-y-2 p-4">
                      <p className="font-bold">Sample notification title</p>
                      <p className="text-xs text-muted-foreground">Sample message content…</p>
                    </div>
                    <div className="border-t border-border/30 bg-navy/80 px-4 py-2 text-center text-xs text-primary/80">
                      {editedBranding.footer_text}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email preview</DialogTitle>
            <DialogDescription>How subscribers will see this notification.</DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg border bg-navy text-navy-foreground">
            <div
              className="px-6 py-4 text-center"
              style={{ backgroundColor: editedBranding.primary_color }}
            >
              <h2 className="text-xl font-bold text-white">{editedBranding.header_text}</h2>
            </div>
            <div className="space-y-4 p-6">
              <h1 className="text-2xl font-bold">{notificationTitle || "Notification title"}</h1>
              <Badge variant="outline">
                {selectedJurisdictionMeta
                  ? `${selectedJurisdictionMeta.jurisdiction_name}, ${selectedJurisdictionMeta.jurisdiction_state}`
                  : "Jurisdiction"}
              </Badge>
              <p className="whitespace-pre-wrap opacity-95">
                {notificationMessage || "Message…"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close
            </Button>
            <Button
              disabled={sending}
              onClick={() => {
                setShowPreview(false);
                void handleSendNotification();
              }}
            >
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
