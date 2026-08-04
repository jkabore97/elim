import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Language = 'en' | 'fr'

const translations = {
  // ---- Feed filters & search ----
  'feed.searchPlaceholder': { en: 'Search posts...', fr: 'Rechercher des publications...' },
  'feed.all': { en: 'All', fr: 'Tout' },
  'feed.videos': { en: 'Videos', fr: 'Vidéos' },
  'feed.audios': { en: 'Audio', fr: 'Audio' },
  'feed.posts': { en: 'Posts', fr: 'Publications' },
  'feed.noMatches': { en: 'Nothing found', fr: 'Aucun résultat' },
  'feed.tryDifferent': { en: 'Try a different search or filter', fr: 'Essayez une autre recherche ou un autre filtre' },
  'post.linkCopied': { en: 'Link copied', fr: 'Lien copié' },

  // ---- Notification prompt ----
  'notifPrompt.title': { en: 'Stay updated', fr: 'Restez informé' },
  'notifPrompt.body': { en: 'Turn on notifications to know when your church shares something new.', fr: 'Activez les notifications pour savoir quand votre église partage du nouveau contenu.' },
  'notifPrompt.enable': { en: 'Turn on', fr: 'Activer' },
  'notifPrompt.later': { en: 'Not now', fr: 'Plus tard' },

  'nav.logs': { en: 'Logs', fr: 'Journaux' },
  'logs.searchPlaceholder': { en: 'Search logs...', fr: 'Rechercher dans les journaux...' },
  'logs.all': { en: 'All', fr: 'Tout' },
  'logs.authFilter': { en: 'Sign-ins', fr: 'Connexions' },
  'logs.postsFilter': { en: 'Posts', fr: 'Publications' },
  'logs.adminFilter': { en: 'Admin', fr: 'Admin' },
  'logs.empty': { en: 'No activity recorded yet', fr: 'Aucune activité enregistrée' },
  'logs.signin': { en: 'Signed in', fr: "S'est connecté" },
  'logs.signup': { en: 'Created an account', fr: 'A créé un compte' },
  'logs.postCreated': { en: 'Published a post', fr: 'A publié' },
  'logs.postEdited': { en: 'Edited a post', fr: 'A modifié une publication' },
  'logs.postDeleted': { en: 'Deleted a post', fr: 'A supprimé une publication' },
  'logs.churchApproved': { en: 'Approved a church', fr: 'A approuvé une église' },
  'logs.churchDenied': { en: 'Denied a church', fr: 'A refusé une église' },
  'logs.directorySynced': { en: 'Synced the church directory', fr: 'A synchronisé le répertoire' },
  'nav.messages': { en: 'Messages', fr: 'Messages' },

  // ---- Roles ----
  'role.pastor': { en: 'Pastor', fr: 'Pasteur' },
  'role.admin': { en: 'Technical Support', fr: 'Support technique' },
  'role.church': { en: 'Church', fr: 'Église' },
  'role.pendingChurch': { en: 'Pending', fr: 'En attente' },
  'role.member': { en: 'Member', fr: 'Membre' },

  // ---- Messaging ----
  'msg.edited': { en: 'edited', fr: 'modifié' },
  'msg.deleteThread': { en: 'Delete conversation', fr: 'Supprimer la conversation' },
  'msg.deleteConfirm': { en: 'Delete all', fr: 'Tout supprimer' },
  'msg.editFailed': { en: "Couldn't edit - try again", fr: 'Échec de la modification - réessayez' },
  'msg.deleteFailed': { en: "Couldn't delete - try again", fr: 'Échec de la suppression - réessayez' },
  'msg.newBadge': { en: 'New', fr: 'Nouveau' },
  'msg.chooseChannel': { en: 'Who would you like to reach?', fr: 'Qui souhaitez-vous contacter ?' },
  'msg.pastorChannel': { en: 'Message the Pastor', fr: 'Écrire au Pasteur' },
  'msg.pastorChannelDesc': { en: 'Prayer, guidance, or anything personal', fr: 'Prière, accompagnement ou toute demande personnelle' },
  'msg.techChannel': { en: 'Technical Support', fr: 'Support technique' },
  'msg.techChannelDesc': { en: 'Problems with the app, your account, or sign-in', fr: "Problèmes avec l'application, votre compte ou la connexion" },
  'msg.pastorTag': { en: 'PASTOR', fr: 'PASTEUR' },
  'msg.techTag': { en: 'TECH', fr: 'TECH' },
  'msg.pastorHint': { en: 'Whatever you share here goes to the Pastor.', fr: 'Ce que vous partagez ici est adressé au Pasteur.' },
  'msg.techHint': { en: 'Describe the problem and we will look into it.', fr: 'Décrivez le problème et nous allons le regarder.' },
  'msg.conversation': { en: 'Conversation', fr: 'Conversation' },
  'msg.usuallyReplies': { en: 'Usually replies within a day', fr: 'Répond généralement sous un jour' },
  'msg.writePlaceholder': { en: 'Write a message...', fr: 'Écrivez un message...' },
  'msg.noMessages': { en: 'No messages yet', fr: 'Aucun message' },
  'msg.startHint': { en: 'Send the first message to start this conversation.', fr: 'Envoyez le premier message pour démarrer cette conversation.' },
  'msg.sendFailed': { en: "Couldn't send - try again", fr: "Échec de l'envoi - réessayez" },
  'msg.loadFailed': { en: "Couldn't load conversations", fr: 'Impossible de charger les conversations' },
  'msg.sending': { en: 'Sending...', fr: 'Envoi...' },
  'msg.recording': { en: 'Recording...', fr: 'Enregistrement...' },
  'msg.micDenied': { en: 'Microphone access was denied.', fr: "L'accès au microphone a été refusé." },
  'msg.notAnImage': { en: 'Please choose an image file.', fr: 'Veuillez choisir un fichier image.' },
  'msg.imageTooLarge': { en: 'Image must be under 10MB.', fr: "L'image doit faire moins de 10 Mo." },
  'msg.sentPhoto': { en: 'Photo', fr: 'Photo' },
  'msg.sentVoice': { en: 'Voice message', fr: 'Message vocal' },
  'msg.newMessage': { en: 'New message', fr: 'Nouveau message' },
  'msg.searchPeople': { en: 'Search members and churches...', fr: 'Rechercher membres et églises...' },
  'msg.searchConversations': { en: 'Search conversations...', fr: 'Rechercher des conversations...' },
  'msg.noPeople': { en: 'No one found', fr: 'Personne trouvée' },
  'msg.noConversations': { en: 'No conversations yet', fr: 'Aucune conversation' },
  'msg.noConversationsHint': { en: 'Messages sent to you will appear here', fr: 'Les messages qui vous sont adressés apparaîtront ici' },
  'msg.noMessagesYet': { en: 'No messages yet', fr: 'Aucun message' },

  'support.title': { en: 'Support', fr: 'Assistance' },
  'support.note': { en: "Having trouble or have a question? Get in touch and we'll help.", fr: 'Un problème ou une question ? Contactez-nous, nous vous aiderons.' },
  'support.emailUs': { en: 'Email support', fr: 'Assistance par e-mail' },
  'support.visitSite': { en: 'Visit our website', fr: 'Visiter notre site web' },
  'footer.privacy': { en: 'Privacy Policy', fr: 'Politique de confidentialité' },
  'logs.loadFailed': { en: "Couldn't load logs", fr: 'Impossible de charger les journaux' },
  'logs.rulesHint': { en: "If this says 'Missing or insufficient permissions', the Firestore rules for activityLogs haven't been published yet in the Firebase console.", fr: "Si le message indique « Missing or insufficient permissions », les règles Firestore pour activityLogs n'ont pas encore été publiées dans la console Firebase." },
  'logs.likeAdded': { en: 'Liked a post', fr: 'A aimé une publication' },
  'logs.likeRemoved': { en: 'Removed a like', fr: "A retiré un j'aime" },
  'logs.commentAdded': { en: 'Commented on a post', fr: 'A commenté une publication' },
  'logs.engagementFilter': { en: 'Likes & comments', fr: "J'aime et commentaires" },
  'logs.today': { en: 'Today', fr: "Aujourd'hui" },
  'logs.yesterday': { en: 'Yesterday', fr: 'Hier' },
  'logs.unknownDate': { en: 'Pending', fr: 'En attente' },

  // ---- Common ----
  'common.church': { en: 'Church', fr: 'Église' },

  // ---- Auth: shared ----
  'auth.signIn': { en: 'Sign In', fr: 'Se connecter' },
  'auth.createAccount': { en: 'Create Account', fr: 'Créer un compte' },
  'auth.continueWithGoogle': { en: 'Continue with Google', fr: 'Continuer avec Google' },
  'auth.or': { en: 'or', fr: 'ou' },
  'auth.member': { en: 'Member', fr: 'Membre' },
  'auth.church': { en: 'Church', fr: 'Église' },
  'auth.fullName': { en: 'Your full name', fr: 'Votre nom complet' },
  'auth.churchName': { en: 'Church name', fr: "Nom de l'église" },
  'auth.cityState': { en: 'City, State', fr: 'Ville, Région' },
  'auth.email': { en: 'Email address', fr: 'Adresse e-mail' },
  'auth.password': { en: 'Password', fr: 'Mot de passe' },
  'auth.confirmPassword': { en: 'Confirm password', fr: 'Confirmer le mot de passe' },
  'auth.phoneNumber': { en: 'Phone number', fr: 'Numéro de téléphone' },
  'auth.forgotPassword': { en: 'Forgot password?', fr: 'Mot de passe oublié ?' },
  'auth.resetSent': { en: 'Password reset email sent — check your inbox.', fr: 'E-mail de réinitialisation envoyé — vérifiez votre boîte de réception.' },
  'auth.enterEmailFirst': { en: 'Enter your email above first, then tap "Forgot password?"', fr: 'Entrez d\'abord votre e-mail ci-dessus, puis appuyez sur « Mot de passe oublié ? »' },
  'auth.pleaseWait': { en: 'Please wait...', fr: 'Veuillez patienter...' },
  'auth.churchApprovalNote': { en: 'Church accounts require approval before you can publish content.', fr: 'Les comptes église doivent être approuvés avant de pouvoir publier du contenu.' },
  'auth.passwordsDontMatch': { en: "Passwords don't match.", fr: 'Les mots de passe ne correspondent pas.' },
  'auth.passwordTooShort': { en: 'Password must be at least 8 characters.', fr: 'Le mot de passe doit contenir au moins 8 caractères.' },
  'auth.phoneRequired': { en: 'Phone number is required.', fr: 'Le numéro de téléphone est requis.' },
  'auth.accountCreated': { en: 'Account created! Sign in below to continue.', fr: 'Compte créé ! Connectez-vous ci-dessous pour continuer.' },
  'auth.somethingWrong': { en: 'Something went wrong', fr: "Une erreur s'est produite" },
  'auth.googleSignInFailed': { en: 'Google sign-in failed', fr: 'Échec de la connexion avec Google' },
  'auth.almostThere': { en: 'Almost there', fr: 'Vous y êtes presque' },
  'auth.tellUsHowYoullUse': { en: "Tell us how you'll be using ELIM", fr: "Dites-nous comment vous allez utiliser ELIM" },
  'auth.finishSetup': { en: 'Finish Setup', fr: "Terminer l'inscription" },
  'auth.welcomeTo': { en: 'Welcome to ELIM', fr: 'Bienvenue sur ELIM' },
  'auth.peacefulPlace': { en: 'A peaceful place for the church community', fr: 'Un espace paisible pour la communauté de l\'église' },
  'auth.firstName': { en: 'First name', fr: 'Prénom' },
  'auth.lastName': { en: 'Last name', fr: 'Nom' },
  'auth.pin': { en: '6-digit PIN', fr: 'Code à 6 chiffres' },
  'auth.confirmPin': { en: 'Confirm PIN', fr: 'Confirmer le code' },
  'auth.yourChurch': { en: 'Your church', fr: 'Votre église' },
  'auth.selectYourChurch': { en: 'Select your church', fr: 'Sélectionnez votre église' },
  'auth.otherNoChurch': { en: "Other / I don't have a church", fr: "Autre / Je n'ai pas d'église" },
  'auth.newChurchName': { en: 'Church name', fr: "Nom de l'église" },
  'auth.showPassword': { en: 'Show password', fr: 'Afficher le mot de passe' },
  'auth.hidePassword': { en: 'Hide password', fr: 'Masquer le mot de passe' },
  'auth.pinsDontMatch': { en: "PINs don't match.", fr: 'Les codes ne correspondent pas.' },
  'auth.pinMustBe6Digits': { en: 'PIN must be exactly 6 digits.', fr: 'Le code doit comporter exactement 6 chiffres.' },
  'auth.phoneInvalid': { en: 'Please enter a valid phone number.', fr: 'Veuillez entrer un numéro de téléphone valide.' },
  'auth.phoneAlreadyRegistered': { en: 'This phone number is already registered — try signing in instead.', fr: 'Ce numéro est déjà enregistré — essayez de vous connecter.' },
  'auth.wrongPhoneOrPin': { en: 'Phone number or PIN is incorrect.', fr: 'Numéro de téléphone ou code incorrect.' },
  'auth.iAmA': { en: 'I am a...', fr: 'Je suis...' },
  'auth.memberSignIn': { en: 'Member', fr: 'Membre' },
  'auth.churchSignIn': { en: 'Church', fr: 'Église' },

  // ---- Landing page ----
  'landing.badge': { en: 'A MODERN HOME FOR YOUR CHURCH COMMUNITY', fr: 'UN FOYER MODERNE POUR VOTRE COMMUNAUTÉ D\'ÉGLISE' },
  'landing.heroLine1': { en: 'Stay close to your', fr: 'Restez proche de votre' },
  'landing.heroLine2': { en: 'church family.', fr: 'famille d\'église.' },
  'landing.heroSubtitle': { en: 'ELIM brings sermons, updates, and encouragement from your church straight to your pocket — photos, audio, video, and real conversation, all in one gentle, focused space.', fr: 'ELIM apporte les sermons, actualités et messages d\'encouragement de votre église directement dans votre poche — photos, audio, vidéo et vraies conversations, le tout dans un espace paisible et dédié.' },
  'landing.getStarted': { en: 'Get Started', fr: 'Commencer' },
  'landing.getStartedFree': { en: 'Get Started Free', fr: 'Commencer gratuitement' },
  'landing.valueProp.photos': { en: 'Photos & Updates', fr: 'Photos et actualités' },
  'landing.valueProp.audio': { en: 'Audio Messages', fr: 'Messages audio' },
  'landing.valueProp.video': { en: 'Sermons & Video', fr: 'Sermons et vidéos' },
  'landing.valueProp.verified': { en: 'Verified Churches', fr: 'Églises vérifiées' },
  'landing.whoItsFor': { en: "WHO IT'S FOR", fr: 'POUR QUI' },
  'landing.builtForBoth': { en: 'Built for both sides of the pew.', fr: 'Pensé pour toute la communauté.' },
  'landing.forChurches': { en: 'For Churches', fr: 'Pour les églises' },
  'landing.forChurches.1': { en: 'Share sermons as text, audio, or video', fr: 'Partagez vos sermons en texte, audio ou vidéo' },
  'landing.forChurches.2': { en: 'Reach your whole congregation instantly', fr: 'Touchez toute votre congrégation instantanément' },
  'landing.forChurches.3': { en: 'A verified badge builds trust with members', fr: 'Un badge vérifié renforce la confiance des membres' },
  'landing.forMembers': { en: 'For Members', fr: 'Pour les membres' },
  'landing.forMembers.1': { en: "Follow your church's feed, wherever you are", fr: 'Suivez le fil de votre église, où que vous soyez' },
  'landing.forMembers.2': { en: 'Comment and stay part of the conversation', fr: 'Commentez et participez à la conversation' },
  'landing.forMembers.3': { en: 'Never miss an update or encouragement', fr: 'Ne manquez plus jamais une actualité ou un message' },
  'landing.gettingStarted': { en: 'GETTING STARTED', fr: 'POUR COMMENCER' },
  'landing.threeSteps': { en: 'Three steps to feeling at home.', fr: 'Trois étapes pour se sentir chez soi.' },
  'landing.step1.title': { en: 'Create your account', fr: 'Créez votre compte' },
  'landing.step1.desc': { en: 'Sign up in seconds as a member, or register your church for verification.', fr: 'Inscrivez-vous en tant que membre, ou enregistrez votre église pour vérification.' },
  'landing.step2.title': { en: 'Follow your church', fr: 'Suivez votre église' },
  'landing.step2.desc': { en: 'Find your church and start seeing their posts in your feed right away.', fr: 'Trouvez votre église et voyez ses publications dans votre fil immédiatement.' },
  'landing.step3.title': { en: 'Stay connected', fr: 'Restez connecté' },
  'landing.step3.desc': { en: 'Like, comment, and never miss a message from the people you gather with.', fr: 'Aimez, commentez, et ne manquez aucun message de votre communauté.' },
  'landing.finalCta1': { en: 'Your church, always', fr: 'Votre église, toujours' },
  'landing.finalCta2': { en: 'within reach.', fr: 'à portée de main.' },
  'landing.footerTagline': { en: 'A peaceful place for the church community.', fr: 'Un espace paisible pour la communauté de l\'église.' },

  // ---- App shell / nav ----
  'nav.feed': { en: 'Feed', fr: 'Fil' },
  'nav.profile': { en: 'Profile', fr: 'Profil' },
  'nav.admin': { en: 'Admin', fr: 'Admin' },
  'nav.post': { en: 'Post', fr: 'Publier' },
  'nav.newPost': { en: 'New Post', fr: 'Nouvelle publication' },
  'app.loading': { en: 'Loading...', fr: 'Chargement...' },
  'app.noPostsYet': { en: 'No posts yet', fr: 'Aucune publication' },
  'app.beFirstToShare': { en: 'Be the first to share something', fr: 'Soyez le premier à partager quelque chose' },
  'app.verifiedChurch': { en: 'Verified Church', fr: 'Église vérifiée' },
  'app.admin': { en: 'Admin', fr: 'Admin' },
  'app.member': { en: 'Member', fr: 'Membre' },

  // ---- Pending screen ----
  'pending.title': { en: 'Waiting for Approval', fr: "En attente d'approbation" },
  'pending.underReview': { en: 'is under review.', fr: 'est en cours d\'examen.' },
  'pending.yourChurchAccount': { en: 'Your church account', fr: 'Votre compte église' },
  'pending.note': { en: 'You will be able to publish once an administrator approves your request.', fr: 'Vous pourrez publier une fois qu\'un administrateur aura approuvé votre demande.' },
  'pending.signOut': { en: 'Sign out', fr: 'Se déconnecter' },

  // ---- Create post modal ----
  'post.new': { en: 'New Post', fr: 'Nouvelle publication' },
  'post.publish': { en: 'Publish', fr: 'Publier' },
  'post.photo': { en: 'Photo', fr: 'Photo' },
  'post.audio': { en: 'Audio', fr: 'Audio' },
  'post.document': { en: 'Document', fr: 'Document' },
  'post.video': { en: 'Video', fr: 'Vidéo' },
  'post.contentPlaceholder': { en: 'Share an encouragement, announcement or message...', fr: 'Partagez un encouragement, une annonce ou un message...' },
  'post.uploadPhoto': { en: 'a photo', fr: 'une photo' },
  'post.uploadAudio': { en: 'an audio file', fr: 'un fichier audio' },
  'post.uploadVideo': { en: 'a video', fr: 'une vidéo' },
  'post.uploadPdf': { en: 'a PDF', fr: 'un PDF' },
  'post.uploading': { en: 'Uploading...', fr: 'Téléversement...' },
  'post.tapToReplace': { en: 'Tap to replace', fr: 'Appuyez pour remplacer' },
  'post.maxSize': { en: 'Max', fr: 'Max' },
  'post.orPasteLinkInstead': { en: 'or paste a link instead', fr: 'ou collez un lien à la place' },
  'post.pasteLink': { en: 'paste a link', fr: 'collez un lien' },
  'post.pasteYoutube': { en: 'Paste YouTube link...', fr: 'Collez le lien YouTube...' },
  'post.pasteFacebook': { en: 'Paste Facebook video link...', fr: 'Collez le lien vidéo Facebook...' },
  'post.pasteAudioUrl': { en: 'Paste audio file URL (mp3, m4a...)', fr: 'Collez l\'URL du fichier audio (mp3, m4a...)' },
  'post.pasteDocUrl': { en: 'Paste a document URL...', fr: 'Collez l\'URL du document...' },
  'post.pasteImageVideoUrl': { en: 'Paste image or video URL...', fr: 'Collez l\'URL de l\'image ou de la vidéo...' },
  'post.pasteCoverUrl': { en: 'Paste cover image URL (optional)', fr: 'Collez l\'URL de l\'image de couverture (facultatif)' },
  'player.listen': { en: 'Listen', fr: 'Écouter' },
  'player.nowPlaying': { en: 'Now playing', fr: 'En cours de lecture' },
  'post.watchOnFacebook': { en: 'Watch on Facebook', fr: 'Regarder sur Facebook' },
  'post.tapToOpen': { en: 'Tap to open', fr: 'Appuyez pour ouvrir' },
  'post.document.fallback': { en: 'Document', fr: 'Document' },
  'post.couldntUpdate': { en: "Couldn't update — try again", fr: 'Échec — réessayez' },
  'post.delete': { en: 'Delete', fr: 'Supprimer' },
  'post.cancel': { en: 'Cancel', fr: 'Annuler' },
  'post.edit': { en: 'Edit Post', fr: 'Modifier la publication' },
  'post.save': { en: 'Save', fr: 'Enregistrer' },
  'post.saving': { en: 'Saving...', fr: 'Enregistrement...' },
  'post.editNote': { en: 'Only the text can be edited here. To change the attached photo, audio, or video, delete this post and share a new one.', fr: 'Seul le texte peut être modifié ici. Pour changer la photo, l\'audio ou la vidéo, supprimez cette publication et partagez-en une nouvelle.' },

  // ---- Comments ----
  'comments.title': { en: 'Comments', fr: 'Commentaires' },
  'comments.none': { en: 'No comments yet', fr: 'Aucun commentaire' },
  'comments.writePlaceholder': { en: 'Write a comment...', fr: 'Écrivez un commentaire...' },

  // ---- Profile tab ----
  'profile.details': { en: 'Profile details', fr: 'Détails du profil' },
  'profile.church': { en: 'Church', fr: 'Église' },
  'profile.churchPlaceholder': { en: 'e.g. Grace Community Church', fr: 'ex. Église de la Grâce' },
  'profile.country': { en: 'Country', fr: 'Pays' },
  'profile.selectCountry': { en: 'Select...', fr: 'Sélectionner...' },
  'profile.city': { en: 'City', fr: 'Ville' },
  'profile.phoneNumber': { en: 'Phone number', fr: 'Numéro de téléphone' },
  'profile.saveChanges': { en: 'Save Changes', fr: 'Enregistrer les modifications' },
  'profile.saving': { en: 'Saving...', fr: 'Enregistrement...' },
  'profile.updated': { en: 'Profile updated.', fr: 'Profil mis à jour.' },
  'profile.imageTypeError': { en: 'Please choose an image file (JPEG, PNG, or WebP).', fr: 'Veuillez choisir un fichier image (JPEG, PNG ou WebP).' },
  'profile.imageSizeError': { en: 'Image must be under 5MB.', fr: 'L\'image doit faire moins de 5 Mo.' },
  'profile.uploadFailed': { en: 'Upload failed', fr: 'Échec du téléversement' },
  'profile.couldNotSave': { en: 'Could not save changes', fr: 'Impossible d\'enregistrer les modifications' },
  'profile.testNotification': { en: 'Send a test notification', fr: 'Envoyer une notification test' },
  'profile.testSent': { en: 'Sent', fr: 'Envoyée' },
  'profile.testFailed': { en: 'Failed', fr: 'Échec' },
  'profile.diagPlatform': { en: 'Platform', fr: 'Plateforme' },
  'profile.diagPermission': { en: 'Permission', fr: 'Autorisation' },
  'profile.diagEnabled': { en: 'Enabled', fr: 'Activé' },
  'profile.diagTokens': { en: 'Devices', fr: 'Appareils' },
  'profile.notifications': { en: 'Notifications', fr: 'Notifications' },
  'profile.notificationsNote': { en: 'Get notified when your church shares something new.', fr: 'Soyez averti quand votre église partage quelque chose de nouveau.' },
  'profile.notificationsPermissionDenied': { en: "Permission denied — check your device's notification settings for this app.", fr: 'Autorisation refusée — vérifiez les paramètres de notification de votre appareil pour cette application.' },

  // ---- Admin panel ----
  'admin.pendingChurches': { en: 'Pending Churches', fr: 'Églises en attente' },
  'admin.noPending': { en: 'No pending churches', fr: 'Aucune église en attente' },
  'admin.noPendingNote': { en: 'New church signups will show up here for approval', fr: 'Les nouvelles inscriptions d\'église apparaîtront ici pour approbation' },
  'admin.approve': { en: 'Approve', fr: 'Approuver' },
  'admin.deny': { en: 'Deny', fr: 'Refuser' },
  'admin.syncDirectory': { en: 'Sync Church Directory', fr: 'Synchroniser le répertoire' },
  'admin.syncDirectoryNote': { en: "Run this if a church isn't showing up as an option for members signing up.", fr: "Exécutez ceci si une église n'apparaît pas comme option pour les membres qui s'inscrivent." },
  'admin.syncing': { en: 'Syncing...', fr: 'Synchronisation...' },
  'admin.synced': { en: 'Directory synced —', fr: 'Répertoire synchronisé —' },
  'admin.churchesSelectable': { en: 'church(es) now selectable.', fr: 'église(s) désormais sélectionnable(s).' },
  'admin.syncFailed': { en: 'Sync failed', fr: 'Échec de la synchronisation' },
} as const

export type TranslationKey = keyof typeof translations

interface LanguageContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function detectDefaultLanguage(): Language {
  try {
    const stored = localStorage.getItem('elim-language')
    if (stored === 'en' || stored === 'fr') return stored
  } catch {
    // localStorage unavailable (e.g. some webview contexts) - fall through to browser detection
  }
  // Most ELIM users are French speakers - default to French unless the
  // device is clearly set to English, rather than the more usual "default
  // to English" assumption.
  const browserLang = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : ''
  return browserLang.startsWith('en') ? 'en' : 'fr'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectDefaultLanguage)

  useEffect(() => {
    try {
      localStorage.setItem('elim-language', language)
    } catch {
      // ignore if storage isn't available
    }
  }, [language])

  const setLanguage = (lang: Language) => setLanguageState(lang)

  const t = (key: TranslationKey): string => {
    const entry = translations[key]
    if (!entry) return key
    return entry[language]
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
