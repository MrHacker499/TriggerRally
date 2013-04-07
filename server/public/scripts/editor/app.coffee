define [
  'jquery'
  'backbone-full'
  'cs!models/index'
  'cs!views/unified'
  'cs!views/home'
  'cs!views/editor'
], (
  $
  Backbone
  models
  UnifiedView
  HomeView
  EditorView
) ->
  jsonClone = (obj) -> JSON.parse JSON.stringify obj

  class Router extends Backbone.Router
    constructor: (@app) ->
      super()

    routes:
      "track/:trackId/edit": "trackEdit"
      "": "home"

    home: ->
      uni = @app.unifiedView
      uni.setView (new HomeView @app, uni.client).render()

    trackEdit: (trackId) ->
      uni = @app.unifiedView
      unless uni.getView() instanceof EditorView
        uni.setView (new EditorView @app, uni.client).render()
      root = @app.root

      # TODO: Let the editor do this itself?
      track = models.Track.findOrCreate trackId
      track.fetch
        success: ->
          track.env.fetch
            success: ->
              Backbone.trigger "app:settrack", track, yes

  class RootModel extends models.Model
    models.buildProps @, [ 'track', 'user' ]
    bubbleAttribs: [ 'track', 'user' ]
    # initialize: ->
    #   super
    #   @on 'all', (event) ->
    #     return unless event.startsWith 'change:track.config'
    #     console.log "RootModel: \"#{event}\""
    #     # console.log "RootModel: " + JSON.stringify arguments

  class App
    constructor: ->
      @root = new RootModel
        user: null
        track: null

      @unifiedView = new UnifiedView @
      @unifiedView.render()

      @router = new Router @

      Backbone.on 'app:settrack', @setTrack, @
      Backbone.on 'app:checklogin', @checkUserLogin, @
      Backbone.on 'app:logout', @logout, @

      @checkUserLogin()
      Backbone.history.start pushState: yes

    setTrack: (track, fromRouter) ->
      lastTrack = @root.track
      return if track is lastTrack
      @root.track = track
      # TODO: Deep comparison with lastTrack to find out which events to fire.
      track.trigger 'change:env' if track.env isnt lastTrack?.env
      track.trigger 'change:id'
      track.trigger 'change:name'
      track.trigger 'change:published'
      track.trigger 'change:user'
      track.trigger 'change:config.course.checkpoints.'
      track.trigger 'change:config.course.startposition.'
      track.trigger 'change:config.scenery.'

    checkUserLogin: ->
      $.ajax('/v1/auth/me')
      .done (data) =>
        if data.user
          user = models.User.findOrCreate data.user.id
          user.set user.parse data.user
          @root.user = user
          Backbone.trigger 'app:status', 'Logged in'
        else
          @logout()

    logout: ->
      @root.user = null
      Backbone.trigger 'app:status', 'Logged out'
